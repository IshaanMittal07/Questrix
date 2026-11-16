import { describe, expect, it } from "vitest";
import { authCallbackUrl, nextFromSearch } from "@/lib/auth/next";

describe("nextFromSearch", () => {
  it("returns a safe next path", () => {
    expect(nextFromSearch("?next=%2Fhabits%3Ftab%3Dweek")).toBe(
      "/habits?tab=week",
    );
  });

  it.each([
    "",
    "?next=",
    "?next=%2F%2Fevil.com",
    "?next=https://evil.com",
    "?next=%2F%5Cevil.com", // "/\evil.com"
    "?next=%2F%09%2Fevil.com", // "/<tab>/evil.com"
    "?next=%2F..%2F%2Fevil.com", // dot segments collapse to "//evil.com"
  ])("falls back to /today for %j", (search) =>
    expect(nextFromSearch(search)).toBe("/today"),
  );

  it("decodes once: a double-encoded // stays an inert path segment", () => {
    const next = nextFromSearch("?next=%2F%252F%252Fevil.com");
    expect(next).toBe("/%2F%2Fevil.com");
    expect(new URL(next, "https://questrix.app").origin).toBe(
      "https://questrix.app",
    );
  });
});

describe("authCallbackUrl", () => {
  const origin = "https://questrix.app";

  it("omits next for home", () => {
    expect(authCallbackUrl(origin, "/today")).toBe(
      "https://questrix.app/auth/callback",
    );
  });

  it("carries next as an encoded query param", () => {
    expect(authCallbackUrl(origin, "/habits?tab=week")).toBe(
      "https://questrix.app/auth/callback?next=%2Fhabits%3Ftab%3Dweek",
    );
  });

  it.each(["//evil.com", "/@evil.com", "/%2F%2Fevil.com"])(
    "never leaves our origin for next=%j",
    (next) => {
      const url = new URL(authCallbackUrl(origin, next));
      expect(url.origin).toBe(origin);
      expect(url.pathname).toBe("/auth/callback");
    },
  );
});
