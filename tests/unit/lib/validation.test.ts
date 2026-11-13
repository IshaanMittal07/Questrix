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
  it("keeps same-origin paths", () => {
    expect(safeNextPath("/habits/new")).toBe("/habits/new");
  });
  it.each([null, "", "https://evil.com", "//evil.com", "/\\evil.com", "today"])(
    "falls back for %j",
    (bad) => {
      expect(safeNextPath(bad)).toBe("/today");
    },
  );
});

describe("isValidTimezone", () => {
  it("accepts IANA names and rejects junk", () => {
    expect(isValidTimezone("America/Toronto")).toBe(true);
    expect(isValidTimezone("Pacific/Kiritimati")).toBe(true);
    expect(isValidTimezone("Mars/Olympus")).toBe(false);
  });
});
