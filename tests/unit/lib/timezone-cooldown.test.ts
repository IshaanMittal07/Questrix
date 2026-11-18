import { describe, expect, it } from "vitest";

import { timezoneCooldownUntil } from "@/lib/profile/cooldown";

const CHANGED = "2026-11-18T10:30:00Z";
const NOW = new Date("2026-11-20T00:00:00Z");

describe("timezoneCooldownUntil", () => {
  it("is null when the timezone was never changed", () => {
    expect(timezoneCooldownUntil(null, 7, NOW, "UTC")).toBeNull();
    expect(timezoneCooldownUntil("", 7, NOW, "UTC")).toBeNull();
  });

  it("is null when there is no cooldown", () => {
    expect(timezoneCooldownUntil(CHANGED, 0, NOW, "UTC")).toBeNull();
    expect(timezoneCooldownUntil(CHANGED, -1, NOW, "UTC")).toBeNull();
  });

  it("is null for an unparseable timestamp", () => {
    expect(timezoneCooldownUntil("not a date", 7, NOW, "UTC")).toBeNull();
  });

  it("formats changed_at + days in the given timezone", () => {
    expect(timezoneCooldownUntil(CHANGED, 7, NOW, "UTC")).toBe(
      "Wed, Nov 25, 10:30",
    );
    // A half-hour offset shifts the minutes, not just the hour.
    expect(timezoneCooldownUntil(CHANGED, 7, NOW, "Asia/Kolkata")).toBe(
      "Wed, Nov 25, 16:00",
    );
    // UTC+14 crosses into the next calendar day.
    expect(timezoneCooldownUntil(CHANGED, 7, NOW, "Pacific/Kiritimati")).toBe(
      "Thu, Nov 26, 00:30",
    );
  });

  it("adds whole 24-hour days, not calendar days, across DST", () => {
    // New York springs forward on 2026-03-08: 24h after 07:30 UTC on the 7th
    // (02:30 EST) is 03:30 EDT, since 02:30 local doesn't exist that day.
    expect(
      timezoneCooldownUntil(
        "2026-03-07T07:30:00Z",
        1,
        new Date("2026-03-07T12:00:00Z"),
        "America/New_York",
      ),
    ).toBe("Sun, Mar 8, 03:30");
  });

  it("rounds up to the next minute, so retrying then succeeds", () => {
    expect(
      timezoneCooldownUntil("2026-11-18T10:30:00.001Z", 7, NOW, "UTC"),
    ).toBe("Wed, Nov 25, 10:31");
    expect(timezoneCooldownUntil("2026-11-18T10:30:59Z", 7, NOW, "UTC")).toBe(
      "Wed, Nov 25, 10:31",
    );
    // Already on a minute: unchanged.
    expect(timezoneCooldownUntil("2026-11-18T10:30:00Z", 7, NOW, "UTC")).toBe(
      "Wed, Nov 25, 10:30",
    );
  });

  it("is null once the cooldown has ended, including exactly at the end", () => {
    const until = new Date("2026-11-25T10:30:00Z");
    expect(timezoneCooldownUntil(CHANGED, 7, until, "UTC")).toBeNull();
    expect(
      timezoneCooldownUntil(CHANGED, 7, new Date(until.getTime() + 1), "UTC"),
    ).toBeNull();
    // One millisecond before, it's still locked.
    expect(
      timezoneCooldownUntil(CHANGED, 7, new Date(until.getTime() - 1), "UTC"),
    ).toBe("Wed, Nov 25, 10:30");
  });
});
