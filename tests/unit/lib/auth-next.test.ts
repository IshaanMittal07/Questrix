import { describe, expect, it } from "vitest";
import { authCallbackUrl, nextFromSearch } from "@/lib/auth/next";

describe("nextFromSearch", () => {
  it("returns a safe next path", () => {
    expect(nextFromSearch("?next=%2Fhabits%3Ftab%3Dweek")).toBe(
      "/habits?tab=week",
    );
  });

  it.each(["", "?next=", "?next=%2F%2Fevil.com", "?next=https://evil.com"])(
    "falls back to /today for %j",
    (search) => expect(nextFromSearch(search)).toBe("/today"),
  );
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
});
