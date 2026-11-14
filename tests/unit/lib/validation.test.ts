import { describe, expect, it } from "vitest";
import {
  isValidTimezone,
  safeNextPath,
  usernameSchema,
} from "@/lib/validation/profile";

describe("usernameSchema", () => {
  it("lower-cases and trims", () => {
    expect(usernameSchema.parse("  Alice_99 ")).toBe("alice_99");
  });
  it.each(["ab", "a".repeat(21), "has space", "dash-name", "émile"])(
    "rejects %j",
    (bad) => {
      expect(usernameSchema.safeParse(bad).success).toBe(false);
    },
  );
});

describe("safeNextPath", () => {
  it("keeps same-origin paths with query and hash", () => {
    expect(safeNextPath("/habits/new")).toBe("/habits/new");
    expect(safeNextPath("/u/alice?tab=feed#top")).toBe("/u/alice?tab=feed#top");
  });
  it.each([
    null,
    "",
    "https://evil.com",
    "//evil.com",
    "/\\evil.com",
    "today",
    "/\t/evil.com",
    "/\n/evil.com",
    "/\r/evil.com",
    "\t//evil.com",
    "/a\\..\\..\\/evil.com",
    "/..//evil.com",
    "/.//evil.com",
    "/a/..//evil.com",
    "/%2e%2e//evil.com",
    "/%2E//evil.com",
  ])("falls back for %j", (bad) => {
    expect(safeNextPath(bad)).toBe("/today");
  });
  it("never resolves off-origin for a percent-encoded tab (decoded by URLSearchParams)", () => {
    const next = new URLSearchParams("next=/%09/evil.com").get("next");
    expect(safeNextPath(next)).toBe("/today");
  });
});

describe("isValidTimezone", () => {
  it("accepts IANA names and rejects junk", () => {
    expect(isValidTimezone("America/Toronto")).toBe(true);
    expect(isValidTimezone("Pacific/Kiritimati")).toBe(true);
    expect(isValidTimezone("Mars/Olympus")).toBe(false);
  });
});
