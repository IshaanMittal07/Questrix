// @vitest-environment node
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const signOut = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { signOut } }),
}));

const { POST } = await import("@/app/auth/signout/route");

const SIGNOUT_URL = "https://questrix.app/auth/signout";

function post(headers: Record<string, string>) {
  return POST(new NextRequest(SIGNOUT_URL, { method: "POST", headers }));
}

beforeEach(() => signOut.mockReset());

describe("POST /auth/signout", () => {
  it("refuses a cross-origin post without signing out", async () => {
    const res = await post({ origin: "https://evil.com" });
    expect(res.status).toBe(403);
    expect(signOut).not.toHaveBeenCalled();
    expect(res.headers.get("location")).toBeNull();
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("refuses a post with no Origin or Sec-Fetch-Site", async () => {
    const res = await post({});
    expect(res.status).toBe(403);
    expect(signOut).not.toHaveBeenCalled();
  });

  it("signs out a same-origin post and redirects to /login", async () => {
    const res = await post({ origin: "https://questrix.app" });
    expect(signOut).toHaveBeenCalledOnce();
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("https://questrix.app/login");
  });
});
