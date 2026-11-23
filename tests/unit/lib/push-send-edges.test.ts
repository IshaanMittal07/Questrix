import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { sendAll, type Job } from "@/lib/push/send";

const job = (id: string): Job => ({
  subscription: {
    id,
    endpoint: `https://fcm.googleapis.com/fcm/send/${id}`,
    p256dh: "p",
    auth: "a",
  },
  message: { title: "T", body: "B", url: "/today", tag: "t" },
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

describe("sendAll fairness and error shapes", () => {
  it("doesn't let a slow send hold up the rest of the queue", async () => {
    const gate = deferred();
    const done: string[] = [];
    const send = vi.fn(async (s: { endpoint: string }) => {
      if (s.endpoint.endsWith("/slow")) await gate.promise;
      done.push(s.endpoint.split("/").pop()!);
    });
    const run = sendAll(["slow", "a", "b", "c", "d", "e"].map(job), send, 2);
    await vi.waitFor(() => expect(done).toEqual(["a", "b", "c", "d", "e"]));
    gate.resolve();
    const out = await run;
    expect(out.sent.sort()).toEqual(["a", "b", "c", "d", "e", "slow"]);
  });

  it("uses one worker per job when there are fewer jobs than the limit", async () => {
    let inFlight = 0;
    let peak = 0;
    const send = vi.fn(async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight--;
    });
    await sendAll(["a", "b", "c"].map(job), send, 20);
    expect(peak).toBe(3);
    expect(send).toHaveBeenCalledTimes(3);
  });

  it("sends each job exactly once under concurrency", async () => {
    const send = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, Math.random() * 3));
    });
    const ids = Array.from({ length: 50 }, (_, i) => `j${i}`);
    const out = await sendAll(ids.map(job), send, 7);
    expect(send).toHaveBeenCalledTimes(50);
    expect(out.sent.sort()).toEqual([...ids].sort());
  });

  it.each([
    ["a string status", { statusCode: "410" }],
    ["a thrown string", "410"],
    ["a thrown null", null],
    ["a 401 (bad VAPID)", { statusCode: 401 }],
    ["a 413 (payload too large)", { statusCode: 413 }],
    ["a 429 (rate limited)", { statusCode: 429 }],
  ])("counts %s as failed, not removed", async (_label, err) => {
    const send = vi.fn(async () => {
      throw err;
    });
    expect(await sendAll([job("a")], send)).toEqual({
      sent: [],
      failed: 1,
      removed: [],
      skipped: 0,
    });
  });

  it("keeps going after a synchronous throw from send", async () => {
    const send = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error("sync");
      })
      .mockResolvedValue({});
    expect(await sendAll(["a", "b"].map(job), send, 1)).toEqual({
      sent: ["b"],
      failed: 1,
      removed: [],
      skipped: 0,
    });
  });
});

describe("sendAll deadline", () => {
  it("starts nothing when the deadline has already passed, and counts every job as skipped", async () => {
    const send = vi.fn();
    expect(
      await sendAll(["a", "b", "c"].map(job), send, 2, 1_000, () => 1_000),
    ).toEqual({ sent: [], failed: 0, removed: [], skipped: 3 });
    expect(send).not.toHaveBeenCalled();
  });

  it("finishes a push already in flight at the deadline, but starts no new one", async () => {
    let t = 0;
    const send = vi.fn(async () => {
      t += 10;
      await new Promise((r) => setTimeout(r, 1));
    });
    // One worker: pushes start at 0, 10, 20; at 30 the deadline is reached.
    const out = await sendAll(
      ["a", "b", "c", "d", "e"].map(job),
      send,
      1,
      30,
      () => t,
    );
    expect(out).toEqual({
      sent: ["a", "b", "c"],
      failed: 0,
      removed: [],
      skipped: 2,
    });
  });

  it("counts skipped across all workers", async () => {
    let t = 0;
    const send = vi.fn(async () => {
      t += 1;
    });
    const out = await sendAll(
      Array.from({ length: 50 }, (_, i) => job(String(i))),
      send,
      20,
      7,
      () => t,
    );
    expect(out.sent).toHaveLength(7);
    expect(out.skipped).toBe(43);
    expect(
      out.sent.length + out.failed + out.removed.length + out.skipped,
    ).toBe(50);
  });

  it("has no deadline by default", async () => {
    const out = await sendAll(
      ["a"].map(job),
      vi.fn(async () => {}),
    );
    expect(out.skipped).toBe(0);
  });
});
