import { describe, expect, it } from "vitest";

import {
  cleanHabitText,
  habitCreateSchema,
  habitDaysSchema,
  habitFieldsSchema,
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

describe("NEL (U+0085), matched by Postgres \\s", () => {
  const NEL = ch(0x85);
  it("is trimmed at the ends like the database does", () => {
    expect(cleanHabitText(`${NEL}Read${NEL}`)).toBe("Read");
    expect(habitTitleSchema.parse(`${NEL}Read`)).toBe("Read");
  });
  it("is still a control character inside a title", () => {
    expect(habitTitleSchema.safeParse(`Re${NEL}ad`).success).toBe(false);
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
    for (const t of [
      "24:00",
      "24:00:00",
      "7:30",
      "07:60",
      "07:30:60",
      "noon",
    ]) {
      expect(reminderTimesSchema.safeParse([t]).success).toBe(false);
    }
  });
  it("accepts seconds (PostgREST, time inputs) and truncates to the minute", () => {
    expect(
      reminderTimesSchema.parse(["07:30:00", "07:30:59.5", "21:05:00"]),
    ).toEqual(["07:30", "21:05"]);
  });
  it("caps the raw list size", () => {
    expect(reminderTimesSchema.safeParse(Array(51).fill("07:30")).success).toBe(
      false,
    );
    expect(reminderTimesSchema.parse(Array(50).fill("07:30"))).toEqual([
      "07:30",
    ]);
  });
});

describe("habitDaysSchema raw size", () => {
  it("caps the raw list size", () => {
    expect(habitDaysSchema.safeParse(Array(51).fill(1)).success).toBe(false);
    expect(habitDaysSchema.parse(Array(50).fill(1))).toEqual([1]);
  });
});

describe("habitFieldsSchema", () => {
  it("is the strict, required base for per-field checks", () => {
    expect(
      habitFieldsSchema.pick({ days_of_week: true }).parse({
        days_of_week: [3, 1],
      }),
    ).toEqual({ days_of_week: [1, 3] });
    expect(habitFieldsSchema.safeParse({ title: "Read" }).success).toBe(false);
  });
});

describe("friendly error messages", () => {
  const message = (r: {
    success: boolean;
    error?: { issues: { message: string }[] };
  }) => r.error?.issues[0]?.message;
  it("uses app wording, not Zod defaults", () => {
    expect(message(habitDaysSchema.safeParse([9]))).toBe(
      "Pick a day of the week",
    );
    expect(
      message(
        habitCreateSchema.safeParse({
          title: "Read",
          category: "learning",
          target_per_day: 9,
        }),
      ),
    ).toBe("At most 5 times a day");
    expect(message(habitOrderSchema.safeParse([]))).toBe(
      "No habits to reorder",
    );
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
  it("treats keys given as undefined as absent", () => {
    expect(habitUpdateSchema.safeParse({ title: undefined }).success).toBe(
      false,
    );
    expect(
      habitUpdateSchema.safeParse({ description: undefined }).success,
    ).toBe(false);
    expect(
      habitUpdateSchema.parse({ title: "Walk", icon: undefined }),
    ).toStrictEqual({ title: "Walk" });
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
  it("lowercases ids, so case variants count as duplicates", () => {
    expect(habitOrderSchema.parse([ID_A.toUpperCase()])).toEqual([ID_A]);
    expect(habitOrderSchema.safeParse([ID_A, ID_A.toUpperCase()]).success).toBe(
      false,
    );
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
  it("accepts exactly 20 ids", () => {
    const twenty = Array.from(
      { length: 20 },
      (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    );
    expect(habitOrderSchema.parse(twenty)).toEqual(twenty);
  });
});

const hex = (code: number) =>
  `U+${code.toString(16).toUpperCase().padStart(4, "0")}`;

describe("cleanHabitText parity with habits_clean_text", () => {
  // Both ends of every range the migration strips with chr().
  it.each(
    [
      0xad, 0x061c, 0x180e, 0x200b, 0x200e, 0x200f, 0x202a, 0x202e, 0x2060,
      0x2066, 0x2069, 0x206f, 0x3164, 0xfeff,
    ].map((code) => [hex(code), code] as const),
  )("strips %s inside text", (_, code) => {
    expect(cleanHabitText(`a${ch(code)}b`)).toBe("ab");
  });

  // Neighbours just outside the ranges survive inside text (checked against
  // habits_clean_text on the local database).
  it.each(
    [0xac, 0xae, 0x200a, 0x2010, 0x2029, 0x202f, 0x205f, 0x2070].map(
      (code) => [hex(code), code] as const,
    ),
  )("keeps %s inside text", (_, code) => {
    const s = `a${ch(code)}b`;
    expect(cleanHabitText(s)).toBe(s);
  });

  it("trims Unicode spaces at the ends, like Postgres \\s", () => {
    for (const code of [
      0x0b, 0x0c, 0x1680, 0x2000, 0x2007, 0x200a, 0x2028, 0x2029, 0x202f,
      0x205f, 0x3000,
    ]) {
      expect(cleanHabitText(`${ch(code)}a${ch(code)}`), hex(code)).toBe("a");
    }
  });

  it("keeps ordinary spaces and newlines inside text", () => {
    expect(cleanHabitText("  Line one\nLine  two ")).toBe(
      "Line one\nLine  two",
    );
  });
});

describe("habitTitleSchema limits", () => {
  it("accepts exactly 60 characters and checks length after cleaning", () => {
    expect(habitTitleSchema.parse("a".repeat(60))).toHaveLength(60);
    const padded = `  ${ZWSP}${"a".repeat(60)}${BOM}${NBSP} `;
    expect(habitTitleSchema.parse(padded)).toBe("a".repeat(60));
    expect(habitTitleSchema.safeParse(ch(0x1f4aa).repeat(61)).success).toBe(
      false,
    );
  });

  it("rejects C0 and C1 control characters like [[:cntrl:]]", () => {
    for (const code of [0x01, 0x0a, 0x0d, 0x1f, 0x80, 0x85, 0x9f]) {
      expect(
        habitTitleSchema.safeParse(`a${ch(code)}b`).success,
        hex(code),
      ).toBe(false);
    }
  });

  it("allows non-control separators and ZWJ inside the title", () => {
    for (const code of [0x2028, 0x3000, 0x200d]) {
      expect(
        habitTitleSchema.safeParse(`a${ch(code)}b`).success,
        hex(code),
      ).toBe(true);
    }
  });

  it("rejects non-strings", () => {
    for (const t of [null, undefined, 42]) {
      expect(habitTitleSchema.safeParse(t).success).toBe(false);
    }
  });
});

describe("habitDaysSchema shape", () => {
  it("accepts all seven days and collapses duplicates of one day", () => {
    expect(habitDaysSchema.parse([6, 5, 4, 3, 2, 1, 0])).toEqual([
      0, 1, 2, 3, 4, 5, 6,
    ]);
    expect(habitDaysSchema.parse([3, 3, 3])).toEqual([3]);
  });

  it("rejects nested arrays, nulls and non-arrays", () => {
    for (const d of [[[1, 2]], [null], [1, null], null, "1,2", 3]) {
      expect(habitDaysSchema.safeParse(d).success).toBe(false);
    }
  });
});

describe("reminderTimesSchema edge input", () => {
  it("rejects padding, trailing newlines, signs and non-ASCII digits", () => {
    const fullWidth = (s: string) =>
      [...s]
        .map((c) => (c >= "0" && c <= "9" ? ch(0xff10 + Number(c)) : c))
        .join("");
    for (const t of [
      " 07:30",
      "07:30 ",
      "07:30\n",
      "-1:00",
      "07.30",
      "0730",
      fullWidth("07:30"),
      `${ch(0x0660, 0x0667)}:30`, // Arabic-Indic digits
    ]) {
      expect(reminderTimesSchema.safeParse([t]).success, t).toBe(false);
    }
  });

  it("accepts an empty list", () => {
    expect(reminderTimesSchema.parse([])).toEqual([]);
  });
});

describe("habitCreateSchema output", () => {
  it("adds only the columns that have database defaults", () => {
    expect(
      habitCreateSchema.parse({ title: "Read", category: "learning" }),
    ).toStrictEqual({
      title: "Read",
      category: "learning",
      difficulty: "medium",
      days_of_week: [0, 1, 2, 3, 4, 5, 6],
      target_per_day: 1,
      reminder_times: [],
      reminders_enabled: true,
    });
  });

  it("does not share default arrays between parses", () => {
    const first = habitCreateSchema.parse({ title: "A", category: "mind" });
    first.days_of_week.pop();
    first.reminder_times.push("07:00");
    const second = habitCreateSchema.parse({ title: "B", category: "mind" });
    expect(second.days_of_week).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(second.reminder_times).toEqual([]);
  });

  it("keeps explicit falsy values instead of applying defaults", () => {
    const out = habitCreateSchema.parse({
      title: "Read",
      category: "learning",
      reminders_enabled: false,
      color: null,
    });
    expect(out.reminders_enabled).toBe(false);
    expect(out.color).toBeNull();
  });

  it("requires title and category", () => {
    expect(habitCreateSchema.safeParse({ category: "learning" }).success).toBe(
      false,
    );
    expect(habitCreateSchema.safeParse({ title: "Read" }).success).toBe(false);
    expect(
      habitCreateSchema.safeParse({ title: "   ", category: "learning" })
        .success,
    ).toBe(false);
  });

  it("accepts every SQL colour token", () => {
    for (const color of ["cyan", "violet", "magenta", "success", "warning"]) {
      expect(
        habitCreateSchema.safeParse({ title: "R", category: "mind", color })
          .success,
      ).toBe(true);
    }
  });

  it("accepts the upper bound of each limit, counted in code points", () => {
    const out = habitCreateSchema.parse({
      title: "R",
      category: "mind",
      description: ch(0x1f4aa).repeat(280),
      icon: ch(0x1f4aa).repeat(32),
      target_per_day: 5,
      template_key: "a".repeat(40),
    });
    expect([...(out.description ?? "")]).toHaveLength(280);
    expect([...(out.icon ?? "")]).toHaveLength(32);
    expect(out.target_per_day).toBe(5);
  });

  it("measures description length after cleaning", () => {
    const out = habitCreateSchema.parse({
      title: "R",
      category: "mind",
      description: `  ${"x".repeat(280)}${ZWSP}${ZWSP}  `,
    });
    expect(out.description).toBe("x".repeat(280));
  });

  it("allows newlines inside the description (no control CHECK there)", () => {
    const out = habitCreateSchema.parse({
      title: "R",
      category: "mind",
      description: "Line one\nLine two\n",
    });
    expect(out.description).toBe("Line one\nLine two");
  });

  it.each([
    ["color", "Cyan"],
    ["difficulty", null],
    ["category", null],
    ["target_per_day", "2"],
    ["reminders_enabled", "true"],
    ["reminder_times", null],
    ["days_of_week", null],
    ["template_key", ""],
    ["template_key", null],
    ["description", 42],
  ])("rejects %s = %j", (key, value) => {
    expect(
      habitCreateSchema.safeParse({
        title: "Read",
        category: "learning",
        [key]: value,
      }).success,
    ).toBe(false);
  });
});

describe("habitUpdateSchema output", () => {
  it("does not add a description or icon key when they are absent", () => {
    const out = habitUpdateSchema.parse({ title: "Walk" });
    expect("description" in out).toBe(false);
    expect("icon" in out).toBe(false);
    expect(out).toStrictEqual({ title: "Walk" });
  });

  it("applies no create defaults", () => {
    expect(habitUpdateSchema.parse({ category: "mind" })).toStrictEqual({
      category: "mind",
    });
  });

  it("normalises blank icon to null and cleans description", () => {
    expect(habitUpdateSchema.parse({ icon: `  ${ZWSP}` })).toStrictEqual({
      icon: null,
    });
    expect(
      habitUpdateSchema.parse({ description: ` Hi${ZWSP} ` }),
    ).toStrictEqual({ description: "Hi" });
  });

  it("normalises days and reminder times", () => {
    expect(
      habitUpdateSchema.parse({
        days_of_week: [5, 1, 5],
        reminder_times: ["21:00", "07:00", "21:00"],
      }),
    ).toStrictEqual({
      days_of_week: [1, 5],
      reminder_times: ["07:00", "21:00"],
    });
  });

  it("can clear colour and turn reminders off", () => {
    expect(
      habitUpdateSchema.parse({ color: null, reminders_enabled: false }),
    ).toStrictEqual({ color: null, reminders_enabled: false });
  });

  it("validates the fields it is given", () => {
    for (const patch of [
      { title: "" },
      { title: null },
      { days_of_week: [] },
      { target_per_day: 6 },
      { reminder_times: ["24:00"] },
      { description: "x".repeat(281) },
      { category: null },
    ]) {
      expect(habitUpdateSchema.safeParse(patch).success).toBe(false);
    }
  });
});
