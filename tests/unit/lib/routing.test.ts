import { describe, expect, it } from "vitest";
import {
  isPublicPath,
  routeBeforeProfile,
  routeForOnboarding,
} from "@/lib/supabase/routing";

describe("isPublicPath", () => {
  it.each(["/login", "/auth", "/auth/confirm", "/auth/callback"])(
    "%s is public",
    (p) => expect(isPublicPath(p)).toBe(true),
  );
  it.each(["/today", "/loginx", "/authority", "/onboarding", "/"])(
    "%s is not public",
    (p) => expect(isPublicPath(p)).toBe(false),
  );
});

describe("routeBeforeProfile", () => {
  it("lets signed-out visitors through to public pages", () => {
    expect(routeBeforeProfile(false, "/login")).toEqual({ kind: "next" });
    expect(routeBeforeProfile(false, "/auth/confirm")).toEqual({
      kind: "next",
    });
  });

  it("sends signed-out visitors to /login and clears the onboarding cache", () => {
    expect(routeBeforeProfile(false, "/today")).toEqual({
      kind: "redirect",
      to: "/login",
      clearOnboarded: true,
    });
  });

  it("sends signed-in users away from /login", () => {
    expect(routeBeforeProfile(true, "/login")).toEqual({
      kind: "redirect",
      to: "/today",
    });
  });

  it("lets signed-in users reach auth routes (sign-out, callbacks)", () => {
    expect(routeBeforeProfile(true, "/auth/signout")).toEqual({ kind: "next" });
  });

  it("asks for the onboarding check on app pages", () => {
    expect(routeBeforeProfile(true, "/habits")).toBe("check-onboarding");
    expect(routeBeforeProfile(true, "/onboarding")).toBe("check-onboarding");
  });
});

describe("routeForOnboarding", () => {
  it("sends users who haven't onboarded to /onboarding", () => {
    expect(routeForOnboarding(false, "/today")).toEqual({
      kind: "redirect",
      to: "/onboarding",
    });
    expect(routeForOnboarding(false, "/onboarding")).toEqual({ kind: "next" });
  });

  it("sends onboarded users away from /onboarding", () => {
    expect(routeForOnboarding(true, "/onboarding")).toEqual({
      kind: "redirect",
      to: "/today",
    });
    expect(routeForOnboarding(true, "/shop")).toEqual({ kind: "next" });
  });

  it("never bounces when the lookup failed", () => {
    expect(routeForOnboarding("unknown", "/today")).toEqual({ kind: "next" });
    expect(routeForOnboarding("unknown", "/onboarding")).toEqual({
      kind: "next",
    });
  });
});
