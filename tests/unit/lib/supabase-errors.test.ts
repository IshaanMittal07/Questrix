import { describe, expect, it } from "vitest";

import { serverMessage } from "@/lib/supabase/errors";

describe("serverMessage", () => {
  it("adds one period and the hint", () => {
    expect(serverMessage("Slow down", "Later.")).toBe("Slow down. Later.");
    expect(serverMessage("Slow down.", "Later.")).toBe("Slow down. Later.");
    expect(serverMessage("Really?", null)).toBe("Really?");
    expect(serverMessage("Stop!")).toBe("Stop!");
  });
});
