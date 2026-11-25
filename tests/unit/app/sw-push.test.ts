// @vitest-environment node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

/**
 * public/sw.js evaluated against a fake service worker global: push and
 * notificationclick handlers only (DECISIONS P8, #91).
 */
const SRC = readFileSync(
  fileURLToPath(new URL("../../../public/sw.js", import.meta.url)),
  "utf8",
);
const ORIGIN = "https://questrix.app";
/** U+1F600, two UTF-16 code units (built from its code point, not typed). */
const EMOJI = String.fromCodePoint(0x1f600);
const LONE_SURROGATE =
  /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;

type Handler = (event: unknown) => void;
type FakeWindow = {
  url: string;
  focus: ReturnType<typeof vi.fn>;
  navigate?: ReturnType<typeof vi.fn>;
};

function load(windows: FakeWindow[] = []) {
  const handlers = new Map<string, Handler>();
  const showNotification = vi.fn(async () => undefined);
  const matchAll = vi.fn(async () => windows);
  const openWindow = vi.fn(async () => null);
  const self = {
    location: { origin: ORIGIN },
    registration: { showNotification },
    clients: { matchAll, openWindow, claim: vi.fn() },
    skipWaiting: vi.fn(),
    addEventListener: (type: string, fn: Handler) => handlers.set(type, fn),
  };
  const caches = { open: vi.fn(), keys: vi.fn(), match: vi.fn() };
  new Function("self", "caches", "fetch", SRC)(self, caches, vi.fn());
  return { handlers, showNotification, matchAll, openWindow };
}

/** Dispatch an event and wait for what it handed to waitUntil. */
async function dispatch(h: Handler, event: Record<string, unknown>) {
  let pending: Promise<unknown> = Promise.resolve();
  h({
    ...event,
    waitUntil: (p: Promise<unknown>) => {
      pending = p;
    },
  });
  return pending;
}

function pushData(payload: unknown) {
  return {
    json: () => (typeof payload === "string" ? JSON.parse(payload) : payload),
  };
}

async function push(data: unknown) {
  const sw = load();
  await dispatch(sw.handlers.get("push")!, { data });
  expect(sw.showNotification).toHaveBeenCalledOnce();
  const [title, options] = sw.showNotification.mock.calls[0] as unknown as [
    string,
    {
      body: string;
      tag: string;
      icon: string;
      badge: string;
      data: { url: string };
    },
  ];
  return { title, ...options };
}

const FALLBACK = {
  title: "Questrix",
  body: "You have a habit waiting.",
  tag: "questrix",
  data: { url: "/today" },
};

describe("sw.js push", () => {
  it("registers push and notificationclick handlers", () => {
    const { handlers } = load();
    expect([...handlers.keys()]).toEqual(
      expect.arrayContaining(["push", "notificationclick"]),
    );
  });

  it("shows the payload as text with the icon, badge, tag and url", async () => {
    const sw = load();
    await dispatch(sw.handlers.get("push")!, {
      data: pushData({
        title: "Read 10 pages",
        body: "Keep your 3-day streak going",
        url: "/today?habit=abc-123",
        tag: "habit-abc-123",
      }),
    });
    expect(sw.showNotification).toHaveBeenCalledExactlyOnceWith(
      "Read 10 pages",
      {
        body: "Keep your 3-day streak going",
        icon: "/icons/icon-192.png",
        badge: "/icons/icon-192.png",
        tag: "habit-abc-123",
        data: { url: "/today?habit=abc-123" },
      },
    );
  });

  it("accepts the streak-saver tag", async () => {
    const n = await push(
      pushData({ title: "t", body: "b", tag: "streak-saver" }),
    );
    expect(n.tag).toBe("streak-saver");
  });

  it("does not interpret HTML: the title is passed through as text", async () => {
    const n = await push(pushData({ title: "<b>hi</b>", body: "<img src=x>" }));
    expect(n.title).toBe("<b>hi</b>");
    expect(n.body).toBe("<img src=x>");
  });

  it.each([
    ["no data", undefined],
    ["null data", null],
    ["non-JSON text", pushData("not json {")],
    ["an empty string", pushData("")],
    ["JSON null", pushData(null)],
    ["a JSON number", pushData(42)],
    ["a JSON string", pushData("just text")],
    ["an empty object", pushData({})],
  ])("falls back to generic text for %s", async (_label, data) => {
    const n = await push(data);
    expect(n).toMatchObject(FALLBACK);
  });

  it("falls back per field for wrong types and blank strings", async () => {
    const n = await push(
      pushData({ title: 7, body: "   ", url: 5, tag: ["habit-x"] }),
    );
    expect(n).toMatchObject(FALLBACK);
  });

  it("keeps a good title when other fields are bad", async () => {
    const n = await push(pushData({ title: "Drink water", body: null }));
    expect(n.title).toBe("Drink water");
    expect(n.body).toBe(FALLBACK.body);
  });

  it("truncates the title to 120 and the body to 300 characters", async () => {
    const n = await push(
      pushData({ title: "T".repeat(500), body: "B".repeat(1000) }),
    );
    expect(n.title).toBe("T".repeat(120));
    expect(n.body).toBe("B".repeat(300));
  });

  it("keeps a title of exactly 120 characters", async () => {
    const n = await push(pushData({ title: "T".repeat(120) }));
    expect(n.title).toHaveLength(120);
  });

  it("trims leading and trailing whitespace from the title and body", async () => {
    const n = await push(
      pushData({ title: "  \t Drink water \n", body: "\n  Keep going  " }),
    );
    expect(n.title).toBe("Drink water");
    expect(n.body).toBe("Keep going");
  });

  it("trims before truncating, so leading spaces don't use up the limit", async () => {
    const n = await push(
      pushData({ title: `${" ".repeat(50)}${"T".repeat(120)}` }),
    );
    expect(n.title).toBe("T".repeat(120));
  });

  it("truncates by code point and never splits an emoji", async () => {
    const n = await push(
      pushData({
        title: `${"T".repeat(119)}${EMOJI}x`,
        body: EMOJI.repeat(400),
      }),
    );
    expect(n.title).toBe(`${"T".repeat(119)}${EMOJI}`);
    expect(Array.from(n.title)).toHaveLength(120);
    expect(n.body).toBe(EMOJI.repeat(300));
    expect(n.body).toHaveLength(600);
    expect(LONE_SURROGATE.test(n.title)).toBe(false);
    expect(LONE_SURROGATE.test(n.body)).toBe(false);
  });

  it("keeps a body of exactly 300 emoji", async () => {
    const n = await push(pushData({ body: EMOJI.repeat(300) }));
    expect(n.body).toBe(EMOJI.repeat(300));
  });

  it.each([
    ["an absolute off-origin url", "https://evil.com/today"],
    ["a same-origin absolute url", `${ORIGIN}/today?x=1`],
    ["a protocol-relative url", "//evil.com/today"],
    ["a backslash trick", "/\\evil.com"],
    ["a javascript: url", "javascript:alert(1)"],
    ["a data: url", "data:text/html,<script>1</script>"],
    ["a relative path without a slash", "today"],
    ["a tab inside", "/to\tday"],
    ["a newline inside", "/\n/evil.com"],
    ["an empty string", ""],
    // Same origin as input, protocol-relative once dot segments resolve
    // (security audit of PR #99, B1).
    ["a dot-segment escape", "/..//evil.com"],
    ["a single-dot escape", "/.//evil.com"],
    ["a nested dot-segment escape", "/a/..//evil.com"],
    ["an encoded-dot escape", "/%2e//evil.com"],
  ])("falls back to /today for %s", async (_label, url) => {
    const n = await push(pushData({ title: "t", url }));
    expect(n.data.url).toBe("/today");
  });

  it("keeps the path, query and hash of a same-origin path", async () => {
    const n = await push(pushData({ url: "/today?habit=1#top" }));
    expect(n.data.url).toBe("/today?habit=1#top");
  });

  it("normalises dot segments without leaving the origin", async () => {
    const n = await push(pushData({ url: "/../../today" }));
    expect(n.data.url).toBe("/today");
  });

  it.each([
    "unknown",
    "habit-",
    "habit-has space",
    `habit-${"a".repeat(65)}`,
    "streak-saver-x",
    "xstreak-saver",
    "HABIT-1",
  ])("falls back for the unknown tag %j", async (tag) => {
    const n = await push(pushData({ title: "t", tag }));
    expect(n.tag).toBe("questrix");
  });

  it("accepts a habit tag of 64 id characters", async () => {
    const tag = `habit-${"a".repeat(64)}`;
    const n = await push(pushData({ tag }));
    expect(n.tag).toBe(tag);
  });
});

describe("sw.js notificationclick", () => {
  function click(sw: ReturnType<typeof load>, data: unknown) {
    const close = vi.fn();
    const p = dispatch(sw.handlers.get("notificationclick")!, {
      notification: { close, data },
    });
    return { close, p };
  }

  it("focuses and navigates an open window of our origin", async () => {
    const w: FakeWindow = {
      url: `${ORIGIN}/habits`,
      focus: vi.fn(),
      navigate: vi.fn(async () => undefined),
    };
    w.focus.mockResolvedValue(w);
    const sw = load([w]);
    const { close, p } = click(sw, { url: "/today?habit=1" });
    await p;
    expect(close).toHaveBeenCalledOnce();
    expect(sw.matchAll).toHaveBeenCalledWith({
      type: "window",
      includeUncontrolled: true,
    });
    expect(w.focus).toHaveBeenCalledOnce();
    expect(w.navigate).toHaveBeenCalledExactlyOnceWith("/today?habit=1");
    expect(sw.openWindow).not.toHaveBeenCalled();
  });

  it("skips windows of other origins and picks our own", async () => {
    const other: FakeWindow = {
      url: "https://evil.com/",
      focus: vi.fn(),
      navigate: vi.fn(),
    };
    const own: FakeWindow = {
      url: `${ORIGIN}/`,
      focus: vi.fn(),
      navigate: vi.fn(async () => undefined),
    };
    own.focus.mockResolvedValue(own);
    const sw = load([other, own]);
    await click(sw, { url: "/today" }).p;
    expect(other.focus).not.toHaveBeenCalled();
    expect(own.navigate).toHaveBeenCalledWith("/today");
  });

  it("opens a window when none of ours is open", async () => {
    const sw = load([
      { url: "https://other.example/", focus: vi.fn(), navigate: vi.fn() },
    ]);
    await click(sw, { url: "/today?habit=2" }).p;
    expect(sw.openWindow).toHaveBeenCalledExactlyOnceWith("/today?habit=2");
  });

  it("opens a window when there are no windows at all", async () => {
    const sw = load([]);
    await click(sw, { url: "/today" }).p;
    expect(sw.openWindow).toHaveBeenCalledExactlyOnceWith("/today");
  });

  it("does not throw when focus resolves to a client without navigate", async () => {
    const w: FakeWindow = { url: `${ORIGIN}/`, focus: vi.fn() };
    w.focus.mockResolvedValue({ url: `${ORIGIN}/` });
    const sw = load([w]);
    await expect(click(sw, { url: "/today" }).p).resolves.toBeDefined();
    expect(sw.openWindow).not.toHaveBeenCalled();
  });

  it("opens a window when navigate rejects (an uncontrolled tab)", async () => {
    const w: FakeWindow = {
      url: `${ORIGIN}/habits`,
      focus: vi.fn(),
      navigate: vi.fn(async () => {
        throw new TypeError("This service worker is not the client's active");
      }),
    };
    w.focus.mockResolvedValue(w);
    const sw = load([w]);
    await expect(click(sw, { url: "/today?habit=3" }).p).resolves.toBeNull();
    expect(w.navigate).toHaveBeenCalledExactlyOnceWith("/today?habit=3");
    expect(sw.openWindow).toHaveBeenCalledExactlyOnceWith("/today?habit=3");
  });

  it("opens the re-checked /today when navigate rejects for a bad url", async () => {
    const w: FakeWindow = {
      url: `${ORIGIN}/`,
      focus: vi.fn(),
      navigate: vi.fn(async () => {
        throw new TypeError("uncontrolled");
      }),
    };
    w.focus.mockResolvedValue(w);
    const sw = load([w]);
    await click(sw, { url: "https://evil.com/" }).p;
    expect(w.navigate).toHaveBeenCalledWith("/today");
    expect(sw.openWindow).toHaveBeenCalledExactlyOnceWith("/today");
  });

  it.each([
    ["an off-origin url", { url: "https://evil.com/" }],
    ["a protocol-relative url", { url: "//evil.com/x" }],
    ["a javascript: url", { url: "javascript:alert(1)" }],
    ["a dot-segment escape", { url: "/..//evil.com" }],
    ["an encoded-dot escape", { url: "/%2e//evil.com" }],
    ["missing data", null],
    ["data without a url", {}],
  ])("re-checks the url on click and opens /today for %s", async (_l, data) => {
    const sw = load([]);
    await click(sw, data).p;
    expect(sw.openWindow).toHaveBeenCalledExactlyOnceWith("/today");
  });
});
