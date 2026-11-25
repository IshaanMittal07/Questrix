// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { isClean } from "@/lib/moderation/blocklist";
import { parseFeed, timeAgo } from "@/lib/social/types";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const rpc = vi.fn();
const from = vi.fn();
let signedIn = true;
vi.mock("@/lib/supabase/session", () => ({
  getVerifiedUser: async () =>
    signedIn ? { userId: "u1", supabase: { rpc, from } } : null,
}));

const ID = "11111111-1111-4111-8111-111111111111";

describe("blocklist", () => {
  it("mirrors the SQL filter on whole words", () => {
    expect(isClean("great run today")).toBe(true);
    expect(isClean("what the FUCK")).toBe(false);
    expect(isClean("Scunthorpe")).toBe(true);
  });
});

describe("parseFeed", () => {
  it("parses rows and allowlists author assets", () => {
    const [p] = parseFeed([
      {
        id: ID,
        body: "<b>hi</b>",
        attachment: {
          type: "weekly_summary",
          streak: 3,
          completions: 9,
          points: 120,
          level: 2,
        },
        like_count: 2,
        comment_count: 1,
        created_at: "2026-11-25T10:00:00Z",
        mine: true,
        liked: false,
        author: {
          id: "a",
          username: "alice",
          display_name: null,
          outfit: { svg: "/cosmetics/outfit/lab-coat.svg" },
          accessory: { svg: "https://evil.example/x.svg" },
          name_color: { css: "name-color-gold" },
          name_style: { css: "evil-class" },
        },
      },
    ]);
    expect(p.body).toBe("<b>hi</b>");
    expect(p.attachment).toEqual({
      streak: 3,
      completions: 9,
      points: 120,
      level: 2,
    });
    expect(p.author.layers.outfit).toBe("/cosmetics/outfit/lab-coat.svg");
    expect(p.author.layers.accessory).toBeNull();
    expect(p.author.nameColor).toBe("name-color-gold");
    expect(p.author.nameStyle).toBeNull();
    expect(p.mine).toBe(true);
  });

  it("ignores non-summary attachments and bad input", () => {
    expect(parseFeed(null)).toEqual([]);
    expect(
      parseFeed([{ attachment: { type: "other" } }])[0].attachment,
    ).toBeNull();
  });
});

describe("timeAgo", () => {
  const now = Date.parse("2026-11-25T12:00:00Z");
  it.each([
    ["2026-11-25T11:59:30Z", "now"],
    ["2026-11-25T11:55:00Z", "5m"],
    ["2026-11-25T09:00:00Z", "3h"],
    ["2026-11-23T12:00:00Z", "2d"],
    ["2026-11-01T12:00:00Z", "Nov 1"],
  ])("%s → %s", (iso, want) => expect(timeAgo(iso, now)).toBe(want));
});

describe("social actions", () => {
  beforeEach(() => {
    rpc.mockReset();
    from.mockReset();
    signedIn = true;
  });

  it("refuses unfriendly posts before calling the server", async () => {
    const { createPost } = await import("@/lib/social/actions");
    expect(await createPost("you shit", false)).toEqual({
      ok: false,
      error: "Please keep it friendly.",
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses an empty post", async () => {
    const { createPost } = await import("@/lib/social/actions");
    expect((await createPost("   ", true)).ok).toBe(false);
  });

  it("maps a rate limit", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "QX301" } });
    const { createPost } = await import("@/lib/social/actions");
    expect(await createPost("hello", true)).toEqual({
      ok: false,
      error: "Slow down a little and try again later.",
    });
  });

  it("returns the created post read back through the feed", async () => {
    rpc.mockResolvedValueOnce({ data: ID, error: null }).mockResolvedValueOnce({
      data: [{ id: ID, body: "hello", author: { username: "u" } }],
      error: null,
    });
    const { createPost } = await import("@/lib/social/actions");
    const res = await createPost("hello", false);
    expect(res.ok && res.post?.id).toBe(ID);
    expect(rpc).toHaveBeenNthCalledWith(1, "create_post", {
      p_body: "hello",
      p_attach_summary: false,
    });
  });

  it("validates the feed cursor", async () => {
    const { loadFeed } = await import("@/lib/social/actions");
    expect((await loadFeed("everyone", { createdAt: "nope", id: ID })).ok).toBe(
      false,
    );
    expect((await loadFeed("hot", null)).ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("treats a duplicate like as done", async () => {
    from.mockReturnValue({
      insert: async () => ({ error: { code: "23505" } }),
    });
    const { setLike } = await import("@/lib/social/actions");
    expect(await setLike(ID, true)).toEqual({ ok: true });
  });

  it("validates follow and block input", async () => {
    const { setFollowing, setBlocked } = await import("@/lib/social/actions");
    expect((await setFollowing("x", true)).ok).toBe(false);
    expect((await setBlocked(ID, "yes")).ok).toBe(false);
    expect(from).not.toHaveBeenCalled();
  });

  it("marks the inbox read only up to a valid timestamp", async () => {
    const { markInboxRead } = await import("@/lib/social/actions");
    expect((await markInboxRead("not a date")).ok).toBe(false);
    expect((await markInboxRead(undefined)).ok).toBe(false);
    expect(from).not.toHaveBeenCalled();
  });

  /** A thenable query builder: every call is recorded, awaiting gives `result`. */
  function builder(result: { data: unknown; error: unknown }) {
    const calls: Array<[string, ...unknown[]]> = [];
    const b: Record<string, unknown> = {};
    for (const m of [
      "select",
      "eq",
      "is",
      "in",
      "lte",
      "order",
      "limit",
      "update",
    ]) {
      b[m] = (...args: unknown[]) => {
        calls.push([m, ...args]);
        return b;
      };
    }
    b.then = (ok: (v: unknown) => unknown) => Promise.resolve(result).then(ok);
    return { b, calls };
  }

  it("marks read only items up to the newest one shown", async () => {
    const q = builder({ data: null, error: null });
    from.mockReturnValue(q.b);
    const { markInboxRead } = await import("@/lib/social/actions");
    const through = "2026-11-25T10:00:00.123456+00:00";
    expect(await markInboxRead(through)).toEqual({ ok: true });
    expect(q.calls).toContainEqual(["lte", "created_at", through]);
    expect(q.calls).toContainEqual(["eq", "user_id", "u1"]);
  });

  it.each([
    [3, false],
    [100, false],
    [101, true],
  ])(
    "loads the newest comments oldest-first (%i rows → truncated %s)",
    async (rows, truncated) => {
      // The query returns newest first.
      const newestFirst = Array.from({ length: rows }, (_, i) => ({
        id: `c${rows - i}`,
        body: "b",
        created_at: `t${rows - i}`,
        author_id: "a1",
      }));
      const comments = builder({ data: newestFirst, error: null });
      const authors = builder({
        data: [{ id: "a1", username: "al", display_name: null }],
        error: null,
      });
      from.mockReturnValueOnce(comments.b).mockReturnValueOnce(authors.b);
      const { loadComments } = await import("@/lib/social/actions");
      const res = await loadComments(ID);
      if (!res.ok) throw new Error(res.error);
      expect(comments.calls).toContainEqual([
        "order",
        "created_at",
        { ascending: false },
      ]);
      expect(comments.calls).toContainEqual(["limit", 101]);
      expect(res.truncated).toBe(truncated);
      expect(res.comments).toHaveLength(Math.min(rows, 100));
      // Oldest of the shown ones first, newest last.
      expect(res.comments.at(-1)?.id).toBe(`c${rows}`);
      expect(res.comments[0].id).toBe(`c${rows - Math.min(rows, 100) + 1}`);
    },
  );

  it("is signed out without a session", async () => {
    signedIn = false;
    const { addComment } = await import("@/lib/social/actions");
    expect(await addComment(ID, "hi")).toEqual({
      ok: false,
      error: "You're signed out.",
    });
  });
});
