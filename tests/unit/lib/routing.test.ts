import { describe, expect, it } from "vitest";
import {
  isPublicPath,
  loginPathFor,
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
  it("never redirects API routes: they answer for themselves (a followed redirect could look like success)", () => {
    for (const signedIn of [false, true]) {
      expect(routeBeforeProfile(signedIn, "/api/push/subscribe")).toEqual({
        kind: "next",
      });
      expect(routeBeforeProfile(signedIn, "/api")).toEqual({ kind: "next" });
    }
    // Not a prefix trick: /apix is still a page.
    expect(routeBeforeProfile(false, "/apix")).toMatchObject({
      kind: "redirect",
    });
  });

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

  it("remembers the page a signed-out visitor asked for", () => {
    expect(routeBeforeProfile(false, "/habits", "?tab=week")).toEqual({
      kind: "redirect",
      to: "/login?next=%2Fhabits%3Ftab%3Dweek",
      clearOnboarded: true,
    });
  });

  it("sends signed-in users away from /login", () => {
    expect(routeBeforeProfile(true, "/login")).toEqual({
      kind: "redirect",
      to: "/today",
    });
  });

  it("sends signed-in users on /login to a safe ?next=", () => {
    expect(routeBeforeProfile(true, "/login", "?next=%2Fshop")).toEqual({
      kind: "redirect",
      to: "/shop",
    });
    expect(routeBeforeProfile(true, "/login", "?next=%2F%2Fevil.com")).toEqual({
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
  it("only lets onboarded users reach step 2 (starter habits)", () => {
    expect(routeForOnboarding(true, "/onboarding/habits")).toEqual({
      kind: "next",
    });
    expect(routeForOnboarding(false, "/onboarding/habits")).toEqual({
      kind: "redirect",
      to: "/onboarding",
    });
  });

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

describe("loginPathFor", () => {
  it("adds ?next= for app pages, keeping the query", () => {
    expect(loginPathFor("/shop")).toBe("/login?next=%2Fshop");
    expect(loginPathFor("/u/alice", "?tab=feed")).toBe(
      "/login?next=%2Fu%2Falice%3Ftab%3Dfeed",
    );
  });

  it("leaves ?next= off for bare home, which is the default anyway", () => {
    expect(loginPathFor("/")).toBe("/login");
    expect(loginPathFor("/today")).toBe("/login");
    expect(loginPathFor("/today", "?x=1")).toBe("/login?next=%2Ftoday%3Fx%3D1");
  });

  it("drops a very long next", () => {
    expect(loginPathFor("/shop", `?q=${"a".repeat(600)}`)).toBe("/login");
  });

  it("drops paths safeNextPath would reject or rewrite", () => {
    expect(loginPathFor("//evil.com")).toBe("/login");
    expect(loginPathFor("/a/../b")).toBe("/login");
  });
});
