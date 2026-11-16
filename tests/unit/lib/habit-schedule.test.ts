import { describe, expect, it } from "vitest";

import {
  daysUntilNext,
  describeDays,
  isScheduledOn,
  isScheduledToday,
  localDate,
} from "@/lib/habits/schedule";

const at = (iso: string) => new Date(iso);

describe("localDate", () => {
  it("uses the user's timezone, not the device's", () => {
    // Monday 2026-11-16 12:00 UTC.
    expect(localDate(at("2026-11-16T12:00:00Z"), "UTC")).toEqual({
      key: "2026-11-16",
      weekday: 1,
    });
  });

  it("falls back to UTC for an unknown timezone", () => {
    expect(localDate(at("2026-11-16T23:30:00Z"), "Mars/Olympus")).toEqual({
      key: "2026-11-16",
      weekday: 1,
    });
  });

  describe("America/Toronto, DST starts (Sun 2026-03-08, 02:00 EST -> 03:00 EDT)", () => {
    const tz = "America/Toronto";
    it("local midnight before the switch is 05:00 UTC (EST)", () => {
      expect(localDate(at("2026-03-08T04:59:59Z"), tz)).toEqual({
        key: "2026-03-07",
        weekday: 6,
      });
      expect(localDate(at("2026-03-08T05:00:00Z"), tz)).toEqual({
        key: "2026-03-08",
        weekday: 0,
      });
    });
    it("is still Sunday across the skipped hour", () => {
      expect(localDate(at("2026-03-08T06:59:00Z"), tz).key).toBe("2026-03-08");
      expect(localDate(at("2026-03-08T07:00:00Z"), tz).key).toBe("2026-03-08");
    });
    it("the next local midnight is 04:00 UTC (EDT), a 23-hour day", () => {
      expect(localDate(at("2026-03-09T03:59:59Z"), tz)).toEqual({
        key: "2026-03-08",
        weekday: 0,
      });
      expect(localDate(at("2026-03-09T04:00:00Z"), tz)).toEqual({
        key: "2026-03-09",
        weekday: 1,
      });
    });
  });

  describe("America/Toronto, DST ends (Sun 2026-11-01, 02:00 EDT -> 01:00 EST)", () => {
    const tz = "America/Toronto";
    it("local midnight before the switch is 04:00 UTC (EDT)", () => {
      expect(localDate(at("2026-11-01T03:59:59Z"), tz).weekday).toBe(6);
      expect(localDate(at("2026-11-01T04:00:00Z"), tz)).toEqual({
        key: "2026-11-01",
        weekday: 0,
      });
    });
    it("both 01:30s belong to Sunday", () => {
      expect(localDate(at("2026-11-01T05:30:00Z"), tz).key).toBe("2026-11-01");
      expect(localDate(at("2026-11-01T06:30:00Z"), tz).key).toBe("2026-11-01");
    });
    it("the next local midnight is 05:00 UTC (EST), a 25-hour day", () => {
      // A fixed EDT offset would already call this Monday.
      expect(localDate(at("2026-11-02T04:30:00Z"), tz)).toEqual({
        key: "2026-11-01",
        weekday: 0,
      });
      expect(localDate(at("2026-11-02T05:00:00Z"), tz)).toEqual({
        key: "2026-11-02",
        weekday: 1,
      });
    });
  });

  describe("extreme offsets at the same instant (Mon 2026-11-16 10:30 UTC)", () => {
    const instant = at("2026-11-16T10:30:00Z");
    it("UTC+14 (Pacific/Kiritimati) is already Tuesday", () => {
      expect(localDate(instant, "Pacific/Kiritimati")).toEqual({
        key: "2026-11-17",
        weekday: 2,
      });
    });
    it("UTC+13 (Pacific/Tongatapu) is late Monday", () => {
      expect(localDate(instant, "Pacific/Tongatapu")).toEqual({
        key: "2026-11-16",
        weekday: 1,
      });
    });
    it("UTC-11 (Pacific/Pago_Pago) is still Sunday", () => {
      expect(localDate(instant, "Pacific/Pago_Pago")).toEqual({
        key: "2026-11-15",
        weekday: 0,
      });
    });
    it("UTC+13 crosses into Tuesday at 11:00 UTC", () => {
      expect(
        localDate(at("2026-11-16T11:00:00Z"), "Pacific/Tongatapu").weekday,
      ).toBe(2);
    });
  });

  describe("week wrap", () => {
    it("Saturday in UTC is Sunday in UTC+14", () => {
      // Sat 2026-11-21 10:30 UTC.
      const instant = at("2026-11-21T10:30:00Z");
      expect(localDate(instant, "UTC").weekday).toBe(6);
      expect(localDate(instant, "Pacific/Kiritimati")).toEqual({
        key: "2026-11-22",
        weekday: 0,
      });
    });
    it("Sunday in UTC is Saturday in UTC-11", () => {
      // Sun 2026-11-22 05:00 UTC.
      const instant = at("2026-11-22T05:00:00Z");
      expect(localDate(instant, "UTC").weekday).toBe(0);
      expect(localDate(instant, "Pacific/Pago_Pago")).toEqual({
        key: "2026-11-21",
        weekday: 6,
      });
    });
    it("crosses a year boundary", () => {
      expect(
        localDate(at("2026-12-31T10:30:00Z"), "Pacific/Kiritimati"),
      ).toEqual({ key: "2027-01-01", weekday: 5 });
    });
  });
});

describe("isScheduledToday", () => {
  const weekends = [0, 6];
  it("depends on the user's timezone at the same instant", () => {
    // Sun 2026-11-22 05:00 UTC: Sunday in UTC, Saturday in Pago Pago,
    // Sunday evening in Kiritimati.
    const instant = at("2026-11-22T05:00:00Z");
    expect(isScheduledToday([0], "UTC", instant)).toBe(true);
    expect(isScheduledToday([0], "Pacific/Pago_Pago", instant)).toBe(false);
    expect(isScheduledToday(weekends, "Pacific/Pago_Pago", instant)).toBe(true);
    expect(isScheduledToday([1], "Pacific/Kiritimati", instant)).toBe(false);
  });

  it("uses Toronto's real midnight on the 25-hour day", () => {
    expect(
      isScheduledToday([0], "America/Toronto", at("2026-11-02T04:30:00Z")),
    ).toBe(true);
    expect(
      isScheduledToday([1], "America/Toronto", at("2026-11-02T04:30:00Z")),
    ).toBe(false);
  });

  it("an empty schedule is never due", () => {
    expect(isScheduledToday([], "UTC", at("2026-11-16T12:00:00Z"))).toBe(false);
    expect(isScheduledOn([], 3)).toBe(false);
  });
});

describe("daysUntilNext", () => {
  it("is 0 when scheduled that day", () => {
    expect(daysUntilNext([1, 3, 5], 3)).toBe(0);
  });
  it("counts forward within the week", () => {
    expect(daysUntilNext([1, 3, 5], 4)).toBe(1);
  });
  it("wraps from Saturday into next week", () => {
    expect(daysUntilNext([1], 6)).toBe(2);
    expect(daysUntilNext([0], 6)).toBe(1);
    expect(daysUntilNext([5], 6)).toBe(6);
  });
  it("is null with no valid days", () => {
    expect(daysUntilNext([], 2)).toBeNull();
    expect(daysUntilNext([7, -1], 2)).toBeNull();
  });
});

describe("describeDays", () => {
  it.each([
    [[0, 1, 2, 3, 4, 5, 6], "Every day"],
    [[1, 2, 3, 4, 5], "Weekdays"],
    [[6, 0], "Weekends"],
    [[5, 3, 1], "Mon, Wed, Fri"],
    [[0, 1], "Mon, Sun"],
    [[1, 1, 2], "Mon, Tue"],
    [[2], "Tue"],
    // Near-misses of the named sets fall back to the list.
    [[1, 2, 3, 4, 5, 6], "Mon, Tue, Wed, Thu, Fri, Sat"],
    [[0, 1, 2, 3, 4], "Mon, Tue, Wed, Thu, Sun"],
    [[1, 2, 3, 4, 5, 6, 6], "Mon, Tue, Wed, Thu, Fri, Sat"],
    [[0, 0, 6, 6], "Weekends"],
    [[0], "Sun"],
    // Out-of-range entries are ignored rather than counted toward a set.
    [[1, 2, 3, 4, 5, 7], "Weekdays"],
    [[0, 1, 2, 3, 4, 5, 7], "Mon, Tue, Wed, Thu, Fri, Sun"],
    [[-1, 6], "Sat"],
    [[], ""],
  ])("%j -> %j", (days, label) => {
    expect(describeDays(days)).toBe(label);
  });
});

describe("localDate edge input", () => {
  it("falls back to UTC for an empty timezone, every time", () => {
    const instant = at("2026-11-16T23:30:00Z");
    for (let i = 0; i < 2; i++) {
      expect(localDate(instant, "")).toEqual({
        key: "2026-11-16",
        weekday: 1,
      });
    }
  });

  it("zero-pads month and day", () => {
    expect(localDate(at("2026-01-05T12:00:00Z"), "UTC")).toEqual({
      key: "2026-01-05",
      weekday: 1,
    });
  });

  it("does not reuse one zone's cached formatter for another", () => {
    const instant = at("2026-11-16T10:30:00Z");
    expect(localDate(instant, "Pacific/Kiritimati").weekday).toBe(2);
    expect(localDate(instant, "Pacific/Pago_Pago").weekday).toBe(0);
    expect(localDate(instant, "Pacific/Kiritimati").weekday).toBe(2);
  });

  describe("America/Santiago, where DST switches at local midnight", () => {
    const tz = "America/Santiago";
    it("the day after the spring-forward starts at 01:00 (Sun 2026-09-06)", () => {
      expect(localDate(at("2026-09-06T03:59:59Z"), tz)).toEqual({
        key: "2026-09-05",
        weekday: 6,
      });
      expect(localDate(at("2026-09-06T04:00:00Z"), tz)).toEqual({
        key: "2026-09-06",
        weekday: 0,
      });
    });
    it("the repeated 23:00 hour stays Saturday (fall back, 2026-04-05)", () => {
      // 00:00 -03 becomes 23:00 -04 on Saturday again.
      expect(localDate(at("2026-04-05T02:59:59Z"), tz).key).toBe("2026-04-04");
      expect(localDate(at("2026-04-05T03:30:00Z"), tz)).toEqual({
        key: "2026-04-04",
        weekday: 6,
      });
      expect(localDate(at("2026-04-05T04:00:00Z"), tz)).toEqual({
        key: "2026-04-05",
        weekday: 0,
      });
    });
  });
});

describe("daysUntilNext week wrap", () => {
  it("wraps all the way round to the day before today", () => {
    // Today is Sunday; only Saturday is scheduled: six days away.
    expect(daysUntilNext([6], 0)).toBe(6);
    // Scheduled only the day before today: the longest gap.
    expect(daysUntilNext([2], 3)).toBe(6);
  });
  it("ignores out-of-range entries next to valid ones", () => {
    expect(daysUntilNext([7, 8, 1], 6)).toBe(2);
    expect(daysUntilNext([-1, 3], 4)).toBe(6);
  });
  it("is 0 on every weekday for an every-day habit", () => {
    for (let w = 0; w <= 6; w++) {
      expect(
        daysUntilNext([0, 1, 2, 3, 4, 5, 6], w as 0 | 1 | 2 | 3 | 4 | 5 | 6),
      ).toBe(0);
    }
  });
});
