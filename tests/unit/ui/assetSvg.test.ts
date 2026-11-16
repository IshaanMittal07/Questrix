import { describe, expect, it } from "vitest";
import { assetSvg } from "@/components/avatar/Avatar";

describe("assetSvg", () => {
  it("returns cosmetics paths", () => {
    expect(assetSvg({ svg: "/cosmetics/base-umbra.svg" })).toBe(
      "/cosmetics/base-umbra.svg",
    );
  });

  it.each([
    null,
    undefined,
    "string",
    42,
    {},
    { svg: 1 },
    { svg: "https://evil.com/x.svg" },
    { svg: "//evil.com/cosmetics/x.svg" },
    { svg: "javascript:alert(1)" },
    { svg: "/brand/icon.svg" },
    { svg: "cosmetics/x.svg" },
  ])("rejects %j", (asset) => {
    expect(assetSvg(asset)).toBeNull();
  });
});
