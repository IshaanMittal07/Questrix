import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import manifest from "@/app/manifest";

describe("web app manifest", () => {
  const m = manifest();

  it("matches the plan's PWA settings", () => {
    expect(m.name).toBe("Questrix");
    expect(m.short_name).toBe("Questrix");
    expect(m.display).toBe("standalone");
    expect(m.start_url).toBe("/today");
    expect(m.background_color).toBe("#070A12");
    expect(m.theme_color).toBe("#070A12");
  });

  it("includes 192, 512 and a maskable icon that exist on disk", () => {
    const icons = m.icons ?? [];
    expect(icons.map((i) => i.sizes)).toEqual(
      expect.arrayContaining(["192x192", "512x512"]),
    );
    expect(icons.some((i) => i.purpose === "maskable")).toBe(true);
    for (const icon of icons) {
      expect(existsSync(path.join(process.cwd(), "public", icon.src))).toBe(
        true,
      );
    }
  });
});
