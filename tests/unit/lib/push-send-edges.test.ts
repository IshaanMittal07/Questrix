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
    });
  });
});
