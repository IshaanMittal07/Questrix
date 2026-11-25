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

  it("is signed out without a session", async () => {
    signedIn = false;
    const { addComment } = await import("@/lib/social/actions");
    expect(await addComment(ID, "hi")).toEqual({
      ok: false,
      error: "You're signed out.",
    });
  });
});
