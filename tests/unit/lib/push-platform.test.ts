import { describe, expect, it } from "vitest";
import { isIOS, isStandalone, pushSupport } from "@/lib/push/platform";

const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const IPAD_AS_MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";
const OLD_IPAD =
  "Mozilla/5.0 (iPad; CPU OS 12_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";
const IPOD =
  "Mozilla/5.0 (iPod touch; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15";
const CHROME_WIN =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const ANDROID =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36";

const media = (standalone: boolean) => (q: string) => ({
  matches: standalone && q === "(display-mode: standalone)",
});

describe("isIOS", () => {
  it.each([
    ["iPhone", { userAgent: IPHONE }],
    ["an old iPad UA", { userAgent: OLD_IPAD }],
    ["iPod", { userAgent: IPOD }],
    [
      "iPadOS reporting MacIntel with touch",
      { userAgent: IPAD_AS_MAC, platform: "MacIntel", maxTouchPoints: 5 },
    ],
  ])("is true for %s", (_label, nav) => {
    expect(isIOS(nav)).toBe(true);
  });

  it.each([
    ["Windows desktop", { userAgent: CHROME_WIN, platform: "Win32" }],
    [
      "Android",
      { userAgent: ANDROID, platform: "Linux armv8l", maxTouchPoints: 5 },
    ],
    [
      "a Mac without touch",
      { userAgent: IPAD_AS_MAC, platform: "MacIntel", maxTouchPoints: 0 },
    ],
    [
      "a Mac with a single touch point",
      { userAgent: IPAD_AS_MAC, platform: "MacIntel", maxTouchPoints: 1 },
    ],
    [
      "a Mac with maxTouchPoints undefined",
      { userAgent: IPAD_AS_MAC, platform: "MacIntel" },
    ],
  ])("is false for %s", (_label, nav) => {
    expect(isIOS(nav)).toBe(false);
  });
});

describe("isStandalone", () => {
  it("is true via the display-mode media query", () => {
    expect(isStandalone({ userAgent: IPHONE }, media(true))).toBe(true);
  });

  it("is true via navigator.standalone (iOS)", () => {
    expect(
      isStandalone({ userAgent: IPHONE, standalone: true }, media(false)),
    ).toBe(true);
  });

  it("asks for exactly the standalone display mode", () => {
    const queries: string[] = [];
    isStandalone({ userAgent: IPHONE }, (q) => {
      queries.push(q);
      return { matches: false };
    });
    expect(queries).toEqual(["(display-mode: standalone)"]);
  });

  it("is false in a browser tab", () => {
    expect(isStandalone({ userAgent: IPHONE }, media(false))).toBe(false);
    expect(
      isStandalone({ userAgent: IPHONE, standalone: false }, media(false)),
    ).toBe(false);
  });
});

describe("pushSupport", () => {
  const full = { PushManager: class {}, Notification: class {} };

  it("asks iPhone Safari in a tab to install, even without push APIs", () => {
    expect(
      pushSupport({
        navigator: { userAgent: IPHONE },
        matchMedia: media(false),
      }),
    ).toBe("install");
  });

  it("asks an iPad (MacIntel with touch) in a tab to install", () => {
    expect(
      pushSupport({
        navigator: {
          userAgent: IPAD_AS_MAC,
          platform: "MacIntel",
          maxTouchPoints: 5,
          serviceWorker: {},
        },
        matchMedia: media(false),
        ...full,
      }),
    ).toBe("install");
  });

  it("supports an installed iPhone app with the push APIs (16.4+)", () => {
    expect(
      pushSupport({
        navigator: { userAgent: IPHONE, standalone: true, serviceWorker: {} },
        matchMedia: media(false),
        ...full,
      }),
    ).toBe("supported");
  });

  it("supports an installed iPhone app detected via display-mode", () => {
    expect(
      pushSupport({
        navigator: { userAgent: IPHONE, serviceWorker: {} },
        matchMedia: media(true),
        ...full,
      }),
    ).toBe("supported");
  });

  it("is unsupported in an installed iPhone app before 16.4 (no PushManager)", () => {
    expect(
      pushSupport({
        navigator: { userAgent: IPHONE, standalone: true, serviceWorker: {} },
        matchMedia: media(false),
        Notification: class {},
      }),
    ).toBe("unsupported");
  });

  it("supports desktop Chrome in a tab", () => {
    expect(
      pushSupport({
        navigator: { userAgent: CHROME_WIN, serviceWorker: {} },
        matchMedia: media(false),
        ...full,
      }),
    ).toBe("supported");
  });

  it.each([
    [
      "no service worker",
      { PushManager: class {}, Notification: class {} },
      false,
    ],
    ["no PushManager", { Notification: class {} }, true],
    ["no Notification", { PushManager: class {} }, true],
  ])("is unsupported on desktop with %s", (_label, globals, sw) => {
    expect(
      pushSupport({
        navigator: {
          userAgent: CHROME_WIN,
          ...(sw ? { serviceWorker: {} } : {}),
        },
        matchMedia: media(false),
        ...globals,
      }),
    ).toBe("unsupported");
  });
});
