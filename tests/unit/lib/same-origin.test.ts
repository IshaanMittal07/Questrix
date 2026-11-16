import { describe, expect, it } from "vitest";
import { isSameOriginRequest } from "@/lib/http/same-origin";

const URL_ = "https://questrix.app/auth/signout";

describe("isSameOriginRequest", () => {
  it("accepts a matching Origin", () => {
    const h = new Headers({ origin: "https://questrix.app" });
    expect(isSameOriginRequest(h, URL_)).toBe(true);
  });

  it.each(["https://evil.com", "http://questrix.app", "null"])(
    "rejects Origin %s",
    (origin) => {
      expect(isSameOriginRequest(new Headers({ origin }), URL_)).toBe(false);
    },
  );

  it("falls back to Sec-Fetch-Site when Origin is missing", () => {
    expect(
      isSameOriginRequest(
        new Headers({ "sec-fetch-site": "same-origin" }),
        URL_,
      ),
    ).toBe(true);
    expect(
      isSameOriginRequest(
        new Headers({ "sec-fetch-site": "cross-site" }),
        URL_,
      ),
    ).toBe(false);
  });

  it("rejects a request with neither header", () => {
    expect(isSameOriginRequest(new Headers(), URL_)).toBe(false);
  });

  it.each([
    [{ "sec-fetch-site": "none" }, true],
    [{ "sec-fetch-site": "same-site" }, false],
    [{ origin: "https://evil.com", "sec-fetch-site": "same-origin" }, false],
  ])("headers %j → %s (Origin wins over Sec-Fetch-Site)", (h, ok) => {
    expect(isSameOriginRequest(new Headers(h), URL_)).toBe(ok);
  });
});
