import { afterEach, describe, expect, it, vi } from "vitest";
import { deviceTimezone } from "@/lib/validation/profile";

/** Make the device report `tz` without breaking explicit-timeZone formatters. */
function fakeDeviceZone(tz: string | undefined) {
  const Real = Intl.DateTimeFormat;
  // A regular function, not an arrow: the code under test calls it with `new`.
  vi.spyOn(Intl, "DateTimeFormat").mockImplementation(function (
    locales?: string | string[],
    options?: Intl.DateTimeFormatOptions,
  ) {
    const real = new Real(locales, options);
    if (options?.timeZone) return real;
    return {
      resolvedOptions: () => ({ ...real.resolvedOptions(), timeZone: tz }),
    };
  } as unknown as typeof Intl.DateTimeFormat);
}

afterEach(() => vi.restoreAllMocks());

describe("deviceTimezone", () => {
  it("returns the device's IANA zone", () => {
    fakeDeviceZone("Asia/Kolkata");
    expect(deviceTimezone()).toBe("Asia/Kolkata");
  });

  it("keeps the zone as the device reports it (no alias rewriting)", () => {
    fakeDeviceZone("Asia/Calcutta");
    expect(deviceTimezone()).toBe("Asia/Calcutta");
  });

  it.each([undefined, "", "Etc/Unknown", "Mars/Olympus"])(
    "falls back to UTC for %j",
    (tz) => {
      fakeDeviceZone(tz);
      expect(deviceTimezone()).toBe("UTC");
    },
  );

  it("falls back to UTC when Intl throws", () => {
    vi.spyOn(Intl, "DateTimeFormat").mockImplementation(function () {
      throw new RangeError("boom");
    } as unknown as typeof Intl.DateTimeFormat);
    expect(deviceTimezone()).toBe("UTC");
  });
});
