// @vitest-environment node
import { describe, expect, it } from "vitest";
import robots from "@/app/robots";
import { config } from "@/proxy";

// #110: robots.txt was redirected to /login, which Lighthouse flagged as an
// invalid robots file.
describe("robots.txt", () => {
  const matches = (path: string) =>
    config.matcher.some((m) => new RegExp(`^${m}$`).test(path));

  it("is served without a session (the proxy skips it)", () => {
    expect(matches("/robots.txt")).toBe(false);
    expect(matches("/today")).toBe(true);
  });

  it("allows only the sign-in page and keeps API and auth routes out", () => {
    const { rules } = robots();
    expect(rules).toEqual({
      userAgent: "*",
      allow: "/login",
      disallow: ["/api/", "/auth/"],
    });
  });
});
