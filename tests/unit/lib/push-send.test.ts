import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { CONCURRENCY, sendAll, type Job } from "@/lib/push/send";

const job = (id: string): Job => ({
  subscription: {
    id,
    endpoint: `https://fcm.googleapis.com/fcm/send/${id}`,
    p256dh: "p",
    auth: "a",
  },
  message: { title: "T", body: "B", url: "/today", tag: "t" },
});

const pushError = (statusCode: number) =>
  Object.assign(new Error("Received unexpected response code"), {
    statusCode,
    endpoint: "https://fcm.googleapis.com/secret",
  });

describe("sendAll", () => {
  it("sends each job once, with the keys and a JSON payload", async () => {
    const send = vi.fn().mockResolvedValue({});
    const out = await sendAll([job("a"), job("b")], send);
    expect(out).toEqual({
      sent: ["a", "b"],
      failed: 0,
      removed: [],
      skipped: 0,
    });
    expect(send).toHaveBeenCalledWith(
      {
        endpoint: "https://fcm.googleapis.com/fcm/send/a",
        keys: { p256dh: "p", auth: "a" },
      },
      JSON.stringify({ title: "T", body: "B", url: "/today", tag: "t" }),
    );
  });

  it("removes 404 and 410 subscriptions and counts other errors as failed", async () => {
    const send = vi
      .fn()
      .mockRejectedValueOnce(pushError(410))
      .mockRejectedValueOnce(pushError(404))
      .mockRejectedValueOnce(pushError(500))
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce({});
    const out = await sendAll(["a", "b", "c", "d", "e"].map(job), send, 1);
    expect(out).toEqual({
      sent: ["e"],
      failed: 2,
      removed: ["a", "b"],
      skipped: 0,
    });
  });

  it(`never has more than ${CONCURRENCY} sends in flight`, async () => {
    let inFlight = 0;
    let peak = 0;
    const send = vi.fn(async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight--;
    });
    const out = await sendAll(
      Array.from({ length: 75 }, (_, i) => job(String(i))),
      send,
    );
    expect(out.sent).toHaveLength(75);
    expect(peak).toBe(CONCURRENCY);
  });

  it("does nothing for no jobs", async () => {
    const send = vi.fn();
    expect(await sendAll([], send)).toEqual({
      sent: [],
      failed: 0,
      removed: [],
      skipped: 0,
    });
    expect(send).not.toHaveBeenCalled();
  });
});
