import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { PAGE, RunError, runReminders } from "@/lib/push/run";
import { ZERO, fakeAdmin, gone, reminder, saver, sub } from "./push-fakes";

describe("runReminders", () => {
  it("sends reminders and savers to every device, records successes and drops gone devices", async () => {
    const { admin, calls } = fakeAdmin({
      due_reminders: [{ data: [reminder("h1", [sub("a"), sub("b")])] }],
      due_streak_savers: [{ data: [saver(4, [sub("c")])] }],
    });
    const send = vi.fn(async (s: { endpoint: string }, _payload: string) => {
      void _payload;
      if (s.endpoint.endsWith("/b")) throw gone;
    });
    const out = await runReminders({
      admin,
      send,
      now: new Date("2026-12-01T18:00:30Z"),
      random: () => 0,
    });
    expect(out).toEqual({ ...ZERO, sent: 2, removed: 1 });
    expect(calls.rpc[0]).toEqual([
      "due_reminders",
      { p_now: "2026-12-01T18:00:30.000Z", p_limit: PAGE },
    ]);
    // Page by page: the reminders page is recorded before the saver's sends.
    expect(calls.writes.map((w) => [w.op, w.ids])).toEqual([
      ["update", ["a"]],
      ["delete", ["b"]],
      ["update", ["c"]],
    ]);
    expect(calls.writes.find((w) => w.op === "delete")?.select).toBe("id");
    const payloads = send.mock.calls.map((c) => JSON.parse(c[1]));
    expect(payloads.map((p) => p.tag)).toEqual([
      "habit-h1",
      "habit-h1",
      "streak-saver",
    ]);
  });

  it("pages due_reminders until a short page", async () => {
    const full = Array.from({ length: PAGE }, (_, i) => reminder(`h${i}`));
    const { admin, calls } = fakeAdmin({
      due_reminders: [{ data: full }, { data: [reminder("last")] }],
    });
    const out = await runReminders({ admin, send: vi.fn(async () => {}) });
    expect(calls.rpc.filter(([n]) => n === "due_reminders")).toHaveLength(2);
    expect(out.sent).toBe(PAGE + 1);
  });

  it("sends a page and records it before fetching the next", async () => {
    const full = Array.from({ length: PAGE }, (_, i) => reminder(`h${i}`));
    const { admin, calls } = fakeAdmin({
      due_reminders: [{ data: full }, { data: [] }],
    });
    const send = vi.fn(async () => {
      if (calls.log.at(-1) !== "send") calls.log.push("send");
    });
    await runReminders({ admin, send });
    expect(calls.log).toEqual([
      "rpc due_reminders",
      "send",
      "update",
      "rpc due_reminders",
      "rpc due_streak_savers",
    ]);
  });

  it("skips a malformed row and a user without devices, not the page", async () => {
    const { admin } = fakeAdmin({
      due_reminders: [
        { data: [{ nonsense: true }, reminder("h1", []), reminder("h2")] },
      ],
    });
    const send = vi.fn(async () => {});
    expect(await runReminders({ admin, send })).toEqual({
      ...ZERO,
      sent: 1,
      malformed: 1,
    });
  });

  it("reports a due_reminders error, still runs the saver, and has a result", async () => {
    const { admin, calls } = fakeAdmin({
      due_reminders: [{ error: { code: "PGRST301" } }],
      due_streak_savers: [{ data: [saver(5, [sub("c")])] }],
    });
    const send = vi.fn(async () => {});
    const err = await runReminders({ admin, send }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RunError);
    expect((err as RunError).message).toBe(
      "reminders: due_reminders (PGRST301) failed",
    );
    expect((err as RunError).steps).toEqual(["due_reminders (PGRST301)"]);
    expect((err as RunError).result).toEqual({ ...ZERO, sent: 1 });
    expect(calls.rpc.map(([n]) => n)).toEqual([
      "due_reminders",
      "due_streak_savers",
    ]);
  });

  it("still sends the collected reminders when the saver fails, then reports it", async () => {
    const { admin } = fakeAdmin({
      due_reminders: [{ data: [reminder("h1")] }],
      due_streak_savers: [{ error: { code: "57014" } }],
    });
    const send = vi.fn(async () => {});
    const err = await runReminders({ admin, send }).catch((e: RunError) => e);
    expect(send).toHaveBeenCalledTimes(1);
    expect(err).toBeInstanceOf(RunError);
    expect((err as RunError).message).toBe(
      "reminders: due_streak_savers (57014) failed",
    );
    expect((err as RunError).result).toEqual({ ...ZERO, sent: 1 });
  });

  it("never puts an endpoint or key in an error message", async () => {
    const { admin } = fakeAdmin(
      { due_reminders: [{ data: [reminder("h1")] }] },
      { updateError: () => ({ code: "42501" }) },
    );
    const err = await runReminders({
      admin,
      send: vi.fn(async () => {}),
    }).catch((e: Error) => e);
    expect((err as Error).message).toBe(
      "reminders: record successes (42501) failed",
    );
    expect((err as Error).message).not.toMatch(/googleapis|p256dh|auth-/);
  });
});
