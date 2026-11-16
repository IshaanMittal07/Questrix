import { describe, expect, it } from "vitest";

import {
  cleanHabitText,
  habitCreateSchema,
  habitDaysSchema,
  habitOrderSchema,
  habitTitleSchema,
  habitUpdateSchema,
  reminderTimesSchema,
} from "@/lib/validation/habit";

// Built from code points so this file stays ASCII.
const ch = (...cps: number[]) => String.fromCodePoint(...cps);
const ZWSP = ch(0x200b);
const ZWNJ = ch(0x200c);
const ZWJ = ch(0x200d);
const NBSP = ch(0xa0);
const SHY = ch(0xad);
const LRI = ch(0x2066);
const RLO = ch(0x202e);
const BOM = ch(0xfeff);
const HANGUL_FILLER = ch(0x3164);

const ID_A = "6f1c3a52-4c1e-4b8e-9a3e-2f1b0c9d8e7a";
const ID_B = "0b7a2e4d-1c3f-4a5b-8c6d-7e8f9a0b1c2d";

describe("cleanHabitText", () => {
  it("strips invisible and bidi characters anywhere", () => {
    expect(cleanHabitText(`Re${ZWSP}ad${SHY} ${LRI}more${RLO}${BOM}`)).toBe(
      "Read more",
    );
    expect(cleanHabitText(HANGUL_FILLER)).toBe("");
  });

  it("trims whitespace, NBSP and joiners only at the ends", () => {
    expect(cleanHabitText(`${NBSP} ${ZWJ}Walk${ZWNJ}\t\n`)).toBe("Walk");
  });

  it("keeps joiners inside text (ZWJ emoji, Persian ZWNJ)", () => {
    const meditating = ch(0x1f9d8, 0x200d, 0x2640, 0xfe0f);
    expect(cleanHabitText(meditating)).toBe(meditating);
    const persian = ch(
      0x0645,
      0x06cc,
      0x200c,
      0x062e,
      0x0648,
      0x0627,
      0x0647,
      0x0645,
    );
    expect(cleanHabitText(`${ZWJ}${persian}${ZWNJ}`)).toBe(persian);
  });
});

describe("habitTitleSchema", () => {
  it("cleans before checking", () => {
    expect(habitTitleSchema.parse(`  Drink water${ZWSP} `)).toBe("Drink water");
  });

  it("rejects blank and invisible-only titles", () => {
    for (const t of ["", "   ", `${ZWSP}${ZWJ}${NBSP}`, HANGUL_FILLER]) {
      expect(habitTitleSchema.safeParse(t).success).toBe(false);
    }
  });

  it("counts code points like Postgres char_length", () => {
    const emoji = ch(0x1f4aa); // 2 UTF-16 units, 1 code point
    expect(habitTitleSchema.safeParse(emoji.repeat(60)).success).toBe(true);
    expect(habitTitleSchema.safeParse("a".repeat(61)).success).toBe(false);
  });

  it("rejects control characters inside the title", () => {
    expect(habitTitleSchema.safeParse("Read\tbooks").success).toBe(false);
    expect(habitTitleSchema.safeParse(`Read${ch(0x7f)}`).success).toBe(false);
  });
});

describe("habitDaysSchema", () => {
  it("sorts and de-duplicates like the trigger", () => {
    expect(habitDaysSchema.parse([5, 1, 5, 3])).toEqual([1, 3, 5]);
  });
  it("rejects empty, out-of-range and non-integer days", () => {
    for (const d of [[], [7], [-1], [1.5], ["1"]]) {
      expect(habitDaysSchema.safeParse(d).success).toBe(false);
    }
  });
});

describe("reminderTimesSchema", () => {
  it("sorts and de-duplicates", () => {
    expect(reminderTimesSchema.parse(["21:00", "07:30", "21:00"])).toEqual([
      "07:30",
      "21:00",
    ]);
  });
  it("allows up to 5 distinct times after de-duplication", () => {
    const six = ["01:00", "02:00", "03:00", "04:00", "05:00", "05:00"];
    expect(reminderTimesSchema.parse(six)).toHaveLength(5);
    expect(
      reminderTimesSchema.safeParse([...six.slice(0, 5), "06:00"]).success,
    ).toBe(false);
  });
  it("accepts 00:00 and 23:59 and rejects 24:00 and malformed times", () => {
    expect(reminderTimesSchema.parse(["23:59", "00:00"])).toEqual([
      "00:00",
      "23:59",
    ]);
    for (const t of ["24:00", "7:30", "07:60", "07:30:00", "noon"]) {
      expect(reminderTimesSchema.safeParse([t]).success).toBe(false);
    }
  });
});

describe("habitCreateSchema", () => {
  it("applies the database defaults", () => {
    expect(
      habitCreateSchema.parse({ title: "Read", category: "learning" }),
    ).toMatchObject({
      title: "Read",
      category: "learning",
      difficulty: "medium",
      days_of_week: [0, 1, 2, 3, 4, 5, 6],
      target_per_day: 1,
      reminder_times: [],
      reminders_enabled: true,
    });
  });

  it("normalises blank optional text to null", () => {
    const out = habitCreateSchema.parse({
      title: "Read",
      category: "learning",
      description: `  ${ZWSP} `,
      icon: "",
    });
    expect(out.description).toBeNull();
    expect(out.icon).toBeNull();
  });

  it("rejects server-owned and unknown keys", () => {
    for (const extra of [
      { sort_order: 0 },
      { user_id: ID_A },
      { archived_at: "2026-11-16T00:00:00Z" },
      { created_at: "2026-11-16T00:00:00Z" },
      { id: ID_A },
      { points: 100 },
    ]) {
      expect(
        habitCreateSchema.safeParse({
          title: "Read",
          category: "learning",
          ...extra,
        }).success,
      ).toBe(false);
    }
  });

  it.each([
    ["category", "gaming"],
    ["difficulty", "insane"],
    ["color", "#ff0000"],
    ["target_per_day", 0],
    ["target_per_day", 6],
    ["target_per_day", 1.5],
    ["template_key", "Drink-Water"],
    ["template_key", "a".repeat(41)],
    ["description", "x".repeat(281)],
    ["icon", "x".repeat(33)],
  ])("rejects %s = %j", (key, value) => {
    expect(
      habitCreateSchema.safeParse({
        title: "Read",
        category: "learning",
        [key]: value,
      }).success,
    ).toBe(false);
  });

  it("accepts a fully specified habit", () => {
    const parsed = habitCreateSchema.parse({
      title: "Meditate",
      description: "Ten quiet minutes",
      category: "mind",
      difficulty: "easy",
      icon: ch(0x1f9d8, 0x200d, 0x2640, 0xfe0f),
      color: "violet",
      days_of_week: [6, 0],
      target_per_day: 2,
      reminder_times: ["21:00", "07:00"],
      reminders_enabled: false,
      template_key: "meditate_10",
    });
    expect(parsed.days_of_week).toEqual([0, 6]);
    expect(parsed.reminder_times).toEqual(["07:00", "21:00"]);
  });
});

describe("habitUpdateSchema", () => {
  it("accepts a single field and does not add the others", () => {
    expect(habitUpdateSchema.parse({ title: " Walk " })).toEqual({
      title: "Walk",
    });
  });
  it("can clear optional text with null", () => {
    expect(habitUpdateSchema.parse({ description: null })).toEqual({
      description: null,
    });
  });
  it("rejects an empty update", () => {
    expect(habitUpdateSchema.safeParse({}).success).toBe(false);
  });
  it("cannot change server-owned fields or template_key", () => {
    for (const patch of [
      { sort_order: 3 },
      { archived_at: null },
      { user_id: ID_A },
      { template_key: "read" },
    ]) {
      expect(habitUpdateSchema.safeParse(patch).success).toBe(false);
    }
  });
});

describe("habitOrderSchema", () => {
  it("accepts unique uuids", () => {
    expect(habitOrderSchema.parse([ID_A, ID_B])).toEqual([ID_A, ID_B]);
  });
  it("rejects duplicates, non-uuids, empty and more than 20", () => {
    expect(habitOrderSchema.safeParse([ID_A, ID_A]).success).toBe(false);
    expect(habitOrderSchema.safeParse(["nope"]).success).toBe(false);
    expect(habitOrderSchema.safeParse([]).success).toBe(false);
    const many = Array.from(
      { length: 21 },
      (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    );
    expect(habitOrderSchema.safeParse(many).success).toBe(false);
  });
});
