import { describe, expect, it } from "vitest";
import { assetSvg } from "@/components/avatar/Avatar";

describe("assetSvg", () => {
  it.each([
    "/cosmetics/base-umbra.svg",
    "/cosmetics/avatar_base/base-umbra.svg",
    "/cosmetics/outfit/starter-tee.svg",
  ])("returns cosmetics path %s", (svg) => {
    expect(assetSvg({ svg })).toBe(svg);
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
    { svg: "/cosmetics/../brand/icon.svg" },
    { svg: "/cosmetics/..%2Fx.svg" },
    { svg: "/cosmetics/..\\x.svg" },
    { svg: "/cosmetics/x.svg?y" },
    { svg: "/cosmetics/x.png" },
  ])("rejects %j", (asset) => {
    expect(assetSvg(asset)).toBeNull();
  });
});
