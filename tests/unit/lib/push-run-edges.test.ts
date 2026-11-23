import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  ENDPOINT,
  FETCH_BUDGET_MS,
  MAX_PAGES,
  PAGE,
  RunError,
  SEND_BUDGET_MS,
  WRITE_CHUNK,
  runReminders,
} from "@/lib/push/run";
import {
  ZERO,
  fakeAdmin,
  fakeClock,
  gone,
  reminder,
  saver,
  sub,
} from "./push-fakes";

const ok = () => vi.fn(async () => {});
const fullPage = (prefix: string) =>
  Array.from({ length: PAGE }, (_, i) => reminder(`${prefix}${i}`));
const subs = (n: number, prefix = "d") =>
  Array.from({ length: n }, (_, i) => sub(`${prefix}${i}`));

const reminderPages = (calls: { rpc: [string, unknown][] }) =>
  calls.rpc.filter(([name]) => name === "due_reminders").length;
/** Advance the clock by `ms` on every due_reminders fetch (not the saver). */
const perPage = (clock: { advance: (ms: number) => void }, ms: number) => ({
  onRpc: (name: string) => {
    if (name === "due_reminders") clock.advance(ms);
  },
});
/** A clock at 0 for its first read (the run's start), far later after. */
const lateClock = () => {
  let first = true;
  return () => {
    if (first) {
      first = false;
      return 0;
    }
    return 10 * FETCH_BUDGET_MS;
  };
};

describe("runReminders paging", () => {
  it(`stops after ${MAX_PAGES} pages even when every page stays full, and is truncated`, async () => {
    let n = 0;
    const { admin, calls } = fakeAdmin({
      due_reminders: () => ({ data: fullPage(`p${n++}-`) }),
    });
    const send = ok();
    const out = await runReminders({ admin, send });
    expect(reminderPages(calls)).toBe(MAX_PAGES);
    expect(send).toHaveBeenCalledTimes(MAX_PAGES * PAGE);
    expect(out).toEqual({ ...ZERO, sent: MAX_PAGES * PAGE, truncated: true });
  });

  it("isn't truncated when the cap's last page is short", async () => {
    let n = 0;
    const { admin, calls } = fakeAdmin({
      due_reminders: () =>
        ++n < MAX_PAGES
          ? { data: fullPage(`p${n}-`) }
          : { data: [reminder("last")] },
    });
    const out = await runReminders({ admin, send: ok() });
    expect(reminderPages(calls)).toBe(MAX_PAGES);
    expect(out.truncated).toBe(false);
  });

  it("isn't truncated after a short page", async () => {
    const { admin } = fakeAdmin({
      due_reminders: [{ data: fullPage("a") }, { data: [reminder("b")] }],
    });
    const out = await runReminders({ admin, send: ok() });
    expect(out).toEqual({ ...ZERO, sent: PAGE + 1, truncated: false });
  });

  it("isn't truncated after an empty first page", async () => {
    const { admin } = fakeAdmin({ due_reminders: [{ data: [] }] });
    expect(await runReminders({ admin, send: ok() })).toEqual(ZERO);
  });

  it("isn't truncated when a later due_reminders page fails", async () => {
    const { admin } = fakeAdmin({
      due_reminders: [{ data: fullPage("a") }, { error: { code: "57014" } }],
    });
    const err = await runReminders({ admin, send: ok() }).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(RunError);
    expect((err as RunError).result.truncated).toBe(false);
  });

  it("isn't truncated when page 0 fails", async () => {
    const { admin } = fakeAdmin({
      due_reminders: [{ error: { code: "57014" } }],
    });
    const err = await runReminders({ admin, send: ok() }).catch(
      (e: unknown) => e,
    );
    expect((err as RunError).result).toEqual(ZERO);
  });

  it("passes the same p_now to the saver and to every page", async () => {
    const empty = () =>
      Array.from({ length: PAGE }, (_, i) => reminder(`h${i}`, []));
    const { admin, calls } = fakeAdmin({
      due_reminders: [{ data: empty() }, { data: empty() }, { data: [] }],
    });
    await runReminders({
      admin,
      send: ok(),
      now: new Date("2026-03-29T01:00:00+01:00"),
    });
    expect(calls.rpc.map(([name]) => name)).toEqual([
      "due_streak_savers",
      "due_reminders",
      "due_reminders",
      "due_reminders",
    ]);
    const nows = calls.rpc.map(([, args]) => (args as { p_now: string }).p_now);
    expect(new Set(nows)).toEqual(new Set(["2026-03-29T00:00:00.000Z"]));
  });

  it("defaults p_now to the injected clock's start", async () => {
    const clock = fakeClock(Date.parse("2026-10-25T00:59:59.999Z"));
    const { admin, calls } = fakeAdmin({});
    await runReminders({ admin, send: ok(), clock: clock.now });
    expect(calls.rpc).toEqual([
      ["due_streak_savers", { p_now: "2026-10-25T00:59:59.999Z" }],
      ["due_reminders", { p_now: "2026-10-25T00:59:59.999Z", p_limit: PAGE }],
    ]);
  });

  it("treats a full page of malformed rows as full and keeps paging", async () => {
    const junk = Array.from({ length: PAGE }, () => ({ nonsense: true }));
    const { admin, calls } = fakeAdmin({
      due_reminders: [{ data: junk }, { data: [reminder("h1")] }],
    });
    const out = await runReminders({ admin, send: ok() });
    expect(reminderPages(calls)).toBe(2);
    expect(out).toEqual({ ...ZERO, sent: 1, malformed: PAGE });
  });
});

describe("runReminders savers first", () => {
  it("fetches, sends and records the savers before page 0", async () => {
    const { admin, calls } = fakeAdmin({
      due_streak_savers: [{ data: [saver(5, [sub("c"), sub("g")])] }],
      due_reminders: [{ data: [reminder("h1")] }],
    });
    const send = vi.fn(async (s: { endpoint: string }) => {
      calls.log.push(`send ${s.endpoint.split("/").pop()}`);
      if (s.endpoint.endsWith("/g")) throw gone;
    });
    await runReminders({ admin, send });
    expect(calls.log).toEqual([
      "rpc due_streak_savers",
      "send c",
      "send g",
      "update",
      "delete",
      "rpc due_reminders",
      "send s-h1",
      "update",
    ]);
  });

  it("runs the saver even when the clock is already past every budget", async () => {
    const { admin, calls } = fakeAdmin({
      due_streak_savers: [{ data: [saver(5, [sub("c")])] }],
    });
    await runReminders({ admin, send: ok(), clock: lateClock() });
    expect(calls.rpc[0][0]).toBe("due_streak_savers");
  });

  it("lets a slow saver use up the fetch budget: no reminder page is fetched (they stay unlogged), truncated", async () => {
    const clock = fakeClock();
    const { admin, calls } = fakeAdmin({
      due_streak_savers: [{ data: [saver(5, [sub("c")])] }],
      due_reminders: [{ data: fullPage("a") }, { data: fullPage("b") }],
    });
    const send = vi.fn(async (s: { endpoint: string }) => {
      if (s.endpoint.endsWith("/c")) clock.advance(FETCH_BUDGET_MS);
    });
    const out = await runReminders({ admin, send, clock: clock.now });
    expect(reminderPages(calls)).toBe(0);
    expect(out).toEqual({ ...ZERO, sent: 1, truncated: true });
  });

  it("still fetches the reminders when the saver fails", async () => {
    const { admin, calls } = fakeAdmin({
      due_streak_savers: [{ error: { code: "57014" } }],
      due_reminders: [{ data: [reminder("h1")] }],
    });
    const err = await runReminders({ admin, send: ok() }).catch(
      (e: unknown) => e,
    );
    expect(calls.log).toEqual([
      "rpc due_streak_savers",
      "rpc due_reminders",
      "update",
    ]);
    expect((err as RunError).result).toEqual({ ...ZERO, sent: 1 });
  });
});

describe("runReminders time budgets (fake clock)", () => {
  it("fetches no new page once the fetch budget is spent, and is truncated", async () => {
    const clock = fakeClock();
    let n = 0;
    const { admin, calls } = fakeAdmin(
      { due_reminders: () => ({ data: fullPage(`p${n++}-`) }) },
      // Each page takes 10 s: pages start at 0, 10 and 20 s; at 30 s, stop.
      perPage(clock, 10_000),
    );
    const out = await runReminders({ admin, send: ok(), clock: clock.now });
    expect(calls.rpc.map(([name]) => name)).toEqual([
      "due_streak_savers",
      "due_reminders",
      "due_reminders",
      "due_reminders",
    ]);
    expect(out).toEqual({ ...ZERO, sent: 3 * PAGE, truncated: true });
  });

  it("isn't truncated when the budget is spent but the last page was short", async () => {
    const clock = fakeClock();
    const { admin } = fakeAdmin(
      { due_reminders: [{ data: [reminder("only")] }] },
      perPage(clock, 2 * FETCH_BUDGET_MS),
    );
    const out = await runReminders({ admin, send: ok(), clock: clock.now });
    expect(out.truncated).toBe(false);
  });

  it("fetches a page that starts just under the budget, and not one at it", async () => {
    const clock = fakeClock();
    let n = 0;
    const steps = [FETCH_BUDGET_MS - 1, 1];
    const { admin, calls } = fakeAdmin(
      { due_reminders: () => ({ data: fullPage(`p${n++}-`) }) },
      {
        onRpc: (name) => {
          if (name === "due_reminders") clock.advance(steps.shift() ?? 0);
        },
      },
    );
    const out = await runReminders({ admin, send: ok(), clock: clock.now });
    // Page 1 starts at budget - 1 ms; after it, exactly the budget: stop.
    expect(reminderPages(calls)).toBe(2);
    expect(out.truncated).toBe(true);
  });

  it("fetches no reminder page once the clock is past the budget (left for the next minute)", async () => {
    const { admin, calls } = fakeAdmin({
      due_reminders: [{ data: fullPage("p") }],
      due_streak_savers: [{ data: [saver(5, [sub("c")])] }],
    });
    const send = ok();
    const out = await runReminders({ admin, send, clock: lateClock() });
    expect(calls.rpc.map(([name]) => name)).toEqual(["due_streak_savers"]);
    // Past the send budget too: the saver is fetched (logged) but can't
    // start, and that loss is counted; no reminder is fetched to be lost.
    expect(send).not.toHaveBeenCalled();
    expect(out).toEqual({ ...ZERO, skipped: 1, truncated: true });
  });

  it("starts no push at the send budget and counts the rest as skipped", async () => {
    const clock = fakeClock();
    const { admin, calls } = fakeAdmin({
      due_reminders: [{ data: [reminder("h1", subs(10))] }],
    });
    // Each push takes a fifth of the send budget: five start, then stop.
    const send = vi.fn(async () => {
      clock.advance(SEND_BUDGET_MS / 5);
    });
    const out = await runReminders({ admin, send, clock: clock.now });
    expect(send).toHaveBeenCalledTimes(5);
    expect(out).toEqual({ ...ZERO, sent: 5, skipped: 5 });
    expect(calls.writes).toEqual([
      expect.objectContaining({
        op: "update",
        ids: ["d0", "d1", "d2", "d3", "d4"],
      }),
    ]);
  });

  it("stamps last_success_at from the injected clock", async () => {
    const clock = fakeClock(Date.parse("2026-12-01T08:00:00Z"));
    const update = vi.fn();
    const { admin } = fakeAdmin(
      { due_reminders: [{ data: [reminder("h")] }] },
      { onUpdate: update },
    );
    await runReminders({
      admin,
      send: vi.fn(async () => clock.advance(1_234)),
      clock: clock.now,
    });
    expect(update).toHaveBeenCalledWith({
      last_success_at: "2026-12-01T08:00:01.234Z",
    });
  });
});

describe("runReminders with unexpected data shapes", () => {
  it.each([
    ["null", null],
    ["an object", { habit_id: "h1" }],
    ["a string", "[]"],
    ["a number", 5],
  ])(
    "treats due_reminders returning %s as an empty page",
    async (_label, data) => {
      const { admin, calls } = fakeAdmin({
        due_reminders: [{ data }],
        due_streak_savers: [{ data }],
      });
      const send = vi.fn();
      expect(await runReminders({ admin, send })).toEqual(ZERO);
      expect(send).not.toHaveBeenCalled();
      expect(calls.rpc.filter(([n]) => n === "due_reminders")).toHaveLength(1);
      expect(calls.writes).toEqual([]);
    },
  );

  it("skips a row whose subscriptions column is null (jsonb_agg of no rows), without counting it", async () => {
    const { admin, calls } = fakeAdmin({
      due_reminders: [{ data: [reminder("h1", null), reminder("h2")] }],
      due_streak_savers: [{ data: [saver(5, null)] }],
    });
    const send = ok();
    expect(await runReminders({ admin, send })).toEqual({ ...ZERO, sent: 1 });
    expect(calls.writes).toEqual([
      expect.objectContaining({ op: "update", column: "id", ids: ["s-h2"] }),
    ]);
  });
});

describe("runReminders malformed counts", () => {
  it.each([
    ["an object", { id: "x" }, 1],
    ["a string", "s-1", 1],
    ["a number", 7, 1],
    ["an empty list", [], 0],
    ["a list with a keyless subscription", [{ id: "x", endpoint: "e" }], 1],
    ["a list with a non-string id", [sub("x", { id: 7 })], 1],
    ["a list with null and a number", [null, 3], 2],
  ])(
    "subscriptions as %s: nothing sent, malformed %i",
    async (_label, subscriptions, malformed) => {
      const { admin } = fakeAdmin({
        due_reminders: [{ data: [reminder("h1", subscriptions)] }],
      });
      const send = vi.fn();
      expect(await runReminders({ admin, send })).toEqual({
        ...ZERO,
        malformed,
      });
      expect(send).not.toHaveBeenCalled();
    },
  );

  it("counts a row with no subscriptions column as malformed (unlike a null column)", async () => {
    const { subscriptions: _omit, ...row } = reminder("h1");
    void _omit;
    const { admin } = fakeAdmin({ due_reminders: [{ data: [row] }] });
    const send = vi.fn();
    expect(await runReminders({ admin, send })).toEqual({
      ...ZERO,
      malformed: 1,
    });
    expect(send).not.toHaveBeenCalled();
  });

  it("drops only the bad devices of a row and sends the good ones", async () => {
    const { admin } = fakeAdmin({
      due_reminders: [
        {
          data: [
            reminder("h1", [
              sub("good"),
              sub("bad1", { auth: null }),
              sub("bad2", { endpoint: "https://evil.example/x" }),
            ]),
          ],
        },
      ],
    });
    const send = ok();
    expect(await runReminders({ admin, send })).toEqual({
      ...ZERO,
      sent: 1,
      malformed: 2,
    });
  });

  it("counts malformed reminder rows, saver rows and devices together", async () => {
    const { admin } = fakeAdmin({
      due_reminders: [
        {
          data: [
            { nonsense: true },
            { ...reminder("frac"), streak: 1.5 },
            { ...reminder("pts"), points: "20" },
            { ...reminder("icon"), icon: 3 },
            reminder("obj", { id: "x" }),
            reminder("ok"),
          ],
        },
      ],
      due_streak_savers: [
        {
          data: [
            { streak: "4", subscriptions: [sub("bad")] },
            { streak: 2.5, subscriptions: [sub("frac")] },
            saver(4, [sub("good"), sub("worse", { p256dh: 1 })]),
          ],
        },
      ],
    });
    const send = ok();
    // Rows: 4 reminders + 2 savers; subscriptions: 1 object + 1 device.
    expect(await runReminders({ admin, send })).toEqual({
      ...ZERO,
      sent: 2,
      malformed: 8,
    });
  });
});

describe("ENDPOINT allowlist", () => {
  it.each([
    "https://fcm.googleapis.com/fcm/send/abc",
    "https://updates.push.services.mozilla.com/wpush/v2/abc",
    "https://web.push.apple.com/QGx",
    "https://api.push.apple.com/x",
    "https://wns2-par02p.notify.windows.com/w/?token=x",
  ])("accepts %s", (endpoint) => {
    expect(ENDPOINT.test(endpoint)).toBe(true);
  });

  it.each([
    "http://fcm.googleapis.com/fcm/send/abc",
    "https://fcm.googleapis.com",
    "https://fcm.googleapis.com.evil.com/x",
    "https://evil.com/https://fcm.googleapis.com/",
    "https://fcmXgoogleapis.com/x",
    "https://push.apple.com/x",
    "https://-x.push.apple.com/x",
    "https://x-.notify.windows.com/x",
    "https://evil.com/.push.apple.com/",
    "https://FCM.GOOGLEAPIS.COM/x",
    "https://fcm.googleapis.com:8443/x",
    "https://user@fcm.googleapis.com/x",
    " https://fcm.googleapis.com/x",
  ])("refuses %s", (endpoint) => {
    expect(ENDPOINT.test(endpoint)).toBe(false);
  });

  it("refuses a non-allowlisted endpoint before any request is made", async () => {
    const { admin } = fakeAdmin({
      due_reminders: [
        {
          data: [
            reminder("h1", [
              sub("x", { endpoint: "https://169.254.169.254/latest/" }),
            ]),
          ],
        },
      ],
    });
    const send = vi.fn();
    expect(await runReminders({ admin, send })).toEqual({
      ...ZERO,
      malformed: 1,
    });
    expect(send).not.toHaveBeenCalled();
  });
});

describe("runReminders database writes", () => {
  it("de-duplicates subscription ids within a page when recording successes and removals", async () => {
    // One device gets two habits' reminders: it is one row.
    const { admin, calls } = fakeAdmin({
      due_reminders: [
        {
          data: [
            reminder("h1", [sub("a"), sub("gone")]),
            reminder("h2", [sub("a"), sub("gone")]),
          ],
        },
      ],
    });
    const send = vi.fn(async (s: { endpoint: string }) => {
      if (s.endpoint.endsWith("/gone")) throw gone;
    });
    const out = await runReminders({ admin, send });
    expect(send).toHaveBeenCalledTimes(4);
    expect(calls.writes.map((w) => [w.op, w.column, w.ids])).toEqual([
      ["update", "id", ["a"]],
      ["delete", "id", ["gone"]],
    ]);
    // sent counts pushes delivered; removed counts rows deleted.
    expect(out).toEqual({ ...ZERO, sent: 2, removed: 1 });
  });

  it("writes nothing when nothing was sent or removed", async () => {
    const { admin, calls } = fakeAdmin({
      due_reminders: [{ data: [reminder("h1")] }],
    });
    const send = vi.fn(async () => {
      throw Object.assign(new Error("boom"), { statusCode: 500 });
    });
    expect(await runReminders({ admin, send })).toEqual({
      ...ZERO,
      failed: 1,
    });
    expect(calls.writes).toEqual([]);
  });

  it("records a success and then deletes a device that was delivered once and then gone", async () => {
    // Two pushes to the same device: the first is delivered, the second is 410.
    let first = true;
    const { admin, calls } = fakeAdmin({
      due_reminders: [
        { data: [reminder("h1", [sub("x")]), reminder("h2", [sub("x")])] },
      ],
    });
    const send = vi.fn(async () => {
      if (first) {
        first = false;
        return;
      }
      throw gone;
    });
    expect(await runReminders({ admin, send })).toEqual({
      ...ZERO,
      sent: 1,
      removed: 1,
    });
    // Both writes target the same id; the delete comes last, so it wins.
    expect(calls.writes.map((w) => [w.op, w.ids])).toEqual([
      ["update", ["x"]],
      ["delete", ["x"]],
    ]);
  });

  it.each([
    [WRITE_CHUNK, [WRITE_CHUNK]],
    [WRITE_CHUNK + 1, [WRITE_CHUNK, 1]],
    [2 * WRITE_CHUNK + 50, [WRITE_CHUNK, WRITE_CHUNK, 50]],
  ])("writes %i successes in chunks of %j", async (n, sizes) => {
    const devices = subs(n);
    const { admin, calls } = fakeAdmin({
      due_reminders: [{ data: [reminder("h1", devices)] }],
    });
    expect(await runReminders({ admin, send: ok() })).toEqual({
      ...ZERO,
      sent: n,
    });
    const updates = calls.writes.filter((w) => w.op === "update");
    expect(updates.map((w) => w.ids.length)).toEqual(sizes);
    expect(updates.flatMap((w) => w.ids)).toEqual(devices.map((d) => d.id));
  });

  it("deletes more than a chunk of gone devices in chunks, each asking for ids back", async () => {
    const devices = subs(2 * WRITE_CHUNK + 30, "g");
    const { admin, calls } = fakeAdmin({
      due_reminders: [{ data: [reminder("h1", devices)] }],
    });
    const send = vi.fn(async () => {
      throw gone;
    });
    expect(await runReminders({ admin, send })).toEqual({
      ...ZERO,
      removed: devices.length,
    });
    const deletes = calls.writes.filter((w) => w.op === "delete");
    expect(deletes.map((w) => w.ids.length)).toEqual([
      WRITE_CHUNK,
      WRITE_CHUNK,
      30,
    ]);
    expect(deletes.every((w) => w.select === "id")).toBe(true);
    expect(deletes.flatMap((w) => w.ids)).toEqual(devices.map((d) => d.id));
  });

  it("counts as removed only the rows the delete returned", async () => {
    const devices = subs(WRITE_CHUNK + 10, "g");
    const { admin } = fakeAdmin(
      { due_reminders: [{ data: [reminder("h1", devices)] }] },
      // An overlapping run already deleted every third id.
      { deleted: (ids) => ids.filter((_, i) => i % 3 !== 0) },
    );
    const send = vi.fn(async () => {
      throw gone;
    });
    const out = await runReminders({ admin, send });
    // Chunk 1: 100 ids, 34 of them already gone (0, 3, ..., 99) -> 66.
    // Chunk 2: 10 ids, 4 already gone (0, 3, 6, 9) -> 6.
    expect(out).toEqual({ ...ZERO, removed: 66 + 6 });
  });

  it("counts nothing as removed when the delete returns no rows", async () => {
    const { admin } = fakeAdmin(
      { due_reminders: [{ data: [reminder("h1", [sub("g")])] }] },
      { deleted: () => [] },
    );
    const out = await runReminders({
      admin,
      send: vi.fn(async () => {
        throw gone;
      }),
    });
    expect(out).toEqual(ZERO);
  });
});

describe("runReminders failure reporting", () => {
  it("attempts both writes when the first fails, and reports every failure in order", async () => {
    const { admin, calls } = fakeAdmin(
      {
        due_reminders: [{ data: [reminder("h1", [sub("ok"), sub("gone")])] }],
        due_streak_savers: [{ error: { code: "57014" } }],
      },
      {
        updateError: () => ({ code: "42501" }),
        deleteError: () => ({ code: "40001" }),
      },
    );
    const send = vi.fn(async (s: { endpoint: string }) => {
      if (s.endpoint.endsWith("/gone")) throw gone;
    });
    const err = await runReminders({ admin, send }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RunError);
    expect(calls.writes.map((w) => w.op)).toEqual(["update", "delete"]);
    expect((err as RunError).steps).toEqual([
      "due_streak_savers (57014)",
      "record successes (42501)",
      "remove subscriptions (40001)",
    ]);
    expect((err as RunError).message).toBe(
      "reminders: due_streak_savers (57014), record successes (42501), remove subscriptions (40001) failed",
    );
    // A failed delete removes nothing; the sends still count.
    expect((err as RunError).result).toEqual({ ...ZERO, sent: 1 });
  });

  it("keeps writing later chunks after one chunk fails", async () => {
    const devices = subs(2 * WRITE_CHUNK + 1);
    const { admin, calls } = fakeAdmin(
      { due_reminders: [{ data: [reminder("h1", devices)] }] },
      { updateError: (n) => (n === 0 ? { code: "08006" } : null) },
    );
    const err = await runReminders({ admin, send: ok() }).catch(
      (e: unknown) => e,
    );
    expect(calls.writes.filter((w) => w.op === "update")).toHaveLength(3);
    expect((err as RunError).steps).toEqual(["record successes (08006)"]);
    expect((err as RunError).result.sent).toBe(devices.length);
  });

  it("lists a step that failed in several chunks once", async () => {
    const devices = subs(3 * WRITE_CHUNK);
    const { admin, calls } = fakeAdmin(
      { due_reminders: [{ data: [reminder("h1", devices)] }] },
      { updateError: () => ({ code: "08006" }) },
    );
    const err = await runReminders({ admin, send: ok() }).catch(
      (e: unknown) => e,
    );
    expect(calls.writes.filter((w) => w.op === "update")).toHaveLength(3);
    expect((err as RunError).message).toBe(
      "reminders: record successes (08006) failed",
    );
  });

  it("lists the same step with different codes separately", async () => {
    const devices = subs(2 * WRITE_CHUNK);
    const { admin } = fakeAdmin(
      { due_reminders: [{ data: [reminder("h1", devices)] }] },
      { updateError: (n) => ({ code: n === 0 ? "08006" : "57014" }) },
    );
    const err = await runReminders({ admin, send: ok() }).catch(
      (e: unknown) => e,
    );
    expect((err as RunError).steps).toEqual([
      "record successes (08006)",
      "record successes (57014)",
    ]);
  });

  it("reports a delete failure on one chunk and still counts the chunks that worked", async () => {
    const devices = subs(WRITE_CHUNK + 5, "g");
    const { admin } = fakeAdmin(
      { due_reminders: [{ data: [reminder("h1", devices)] }] },
      { deleteError: (n) => (n === 1 ? { code: "42501" } : null) },
    );
    const err = await runReminders({
      admin,
      send: vi.fn(async () => {
        throw gone;
      }),
    }).catch((e: unknown) => e);
    expect((err as RunError).message).toBe(
      "reminders: remove subscriptions (42501) failed",
    );
    expect((err as RunError).result).toEqual({ ...ZERO, removed: WRITE_CHUNK });
  });

  it("reports both rpc failures together", async () => {
    const { admin } = fakeAdmin({
      due_reminders: [{ error: { code: "57014" } }],
      due_streak_savers: [{ error: { code: "PGRST301" } }],
    });
    const send = vi.fn();
    const err = await runReminders({ admin, send }).catch((e: unknown) => e);
    expect((err as RunError).message).toBe(
      "reminders: due_streak_savers (PGRST301), due_reminders (57014) failed",
    );
    expect((err as RunError).result).toEqual(ZERO);
    expect(send).not.toHaveBeenCalled();
  });

  it("sends the earlier pages when a later due_reminders page fails, then reports it", async () => {
    const { admin, calls } = fakeAdmin({
      due_reminders: [{ data: fullPage("h") }, { error: { code: "57014" } }],
    });
    const send = ok();
    const err = await runReminders({ admin, send }).catch((e: unknown) => e);
    expect((err as RunError).message).toBe(
      "reminders: due_reminders (57014) failed",
    );
    expect(send).toHaveBeenCalledTimes(PAGE);
    expect((err as RunError).result).toEqual({ ...ZERO, sent: PAGE });
    // The saver ran first; the failed page isn't retried.
    expect(calls.rpc.map(([n]) => n)).toEqual([
      "due_streak_savers",
      "due_reminders",
      "due_reminders",
    ]);
  });

  it("never puts a db error message (which could quote data) in the RunError", async () => {
    const { admin } = fakeAdmin({
      due_reminders: [
        {
          error: {
            code: "23514",
            message: "endpoint https://fcm.googleapis.com/fcm/send/secret",
          },
        },
      ],
    });
    const err = await runReminders({ admin, send: ok() }).catch(
      (e: unknown) => e,
    );
    expect((err as RunError).message).not.toContain("googleapis");
  });
});

describe("runReminders payloads", () => {
  it("sends JSON with exactly {title, body, url, tag} and a /today url", async () => {
    const { admin } = fakeAdmin({
      due_reminders: [
        {
          data: [
            { ...reminder("h1"), icon: "📚", category: "learning", streak: 5 },
            { ...reminder("h 2/?&", [sub("s2")]), category: "unknown" },
          ],
        },
      ],
      due_streak_savers: [{ data: [saver(9, [sub("s")])] }],
    });
    const send = vi.fn(async (_s: unknown, _p: string) => {
      void _s;
      void _p;
    });
    await runReminders({ admin, send, random: () => 0.5 });
    const payloads = send.mock.calls.map(([, p]) => JSON.parse(p) as unknown);
    expect(payloads).toHaveLength(3);
    for (const p of payloads) {
      expect(Object.keys(p as object).sort()).toEqual([
        "body",
        "tag",
        "title",
        "url",
      ]);
      for (const v of Object.values(p as object))
        expect(typeof v).toBe("string");
      expect((p as { url: string }).url).toMatch(/^\/today(\?|$)/);
    }
    expect(payloads[0]).toMatchObject({ tag: "streak-saver", url: "/today" });
    expect(payloads[2]).toMatchObject({
      url: "/today?habit=h%202%2F%3F%26",
      tag: "habit-h 2/?&",
    });
  });
});
