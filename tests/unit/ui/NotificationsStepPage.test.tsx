import { render, screen } from "@testing-library/react";
import { isValidElement, Suspense, type ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/push/EnableNotifications", () => ({
  EnableNotifications: () => <p>device-toggle</p>,
}));

type Me = { profile: { onboarded_at: string | null } } | null;
const getMyProfile = vi.fn<() => Promise<Me>>();
vi.mock("@/lib/profile/queries", () => ({
  getMyProfile: () => getMyProfile(),
}));

class RedirectError extends Error {}
const redirect = vi.fn((path: string) => {
  // Like next/navigation: redirect() never returns.
  throw new RedirectError(path);
});
vi.mock("next/navigation", () => ({
  redirect: (path: string) => redirect(path),
}));

const page = await import("@/app/onboarding/notifications/page");
const NotificationsStepPage = page.default;

const onboarded: Me = { profile: { onboarded_at: "2026-11-20T10:00:00Z" } };

/** The page's Suspense'd guard, called as the server would render it. */
function guard(): () => Promise<unknown> {
  const tree = NotificationsStepPage() as ReactElement<{
    children: unknown[];
  }>;
  const boundary = tree.props.children.find(
    (c): c is ReactElement<{ children: ReactElement }> =>
      isValidElement(c) && c.type === Suspense,
  );
  expect(boundary).toBeDefined();
  const el = boundary!.props.children;
  expect(isValidElement(el)).toBe(true);
  return el.type as () => Promise<unknown>;
}

beforeEach(() => {
  getMyProfile.mockReset();
  getMyProfile.mockResolvedValue(onboarded);
  redirect.mockClear();
});

describe("onboarding step 3 (notifications)", () => {
  it("is titled and labelled Step 3", () => {
    expect(page.metadata).toEqual({ title: "Stay on track" });
    render(<NotificationsStepPage />);
    expect(screen.getByText("Step 3")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 1, name: "Stay on track" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/streak of 3\+ days is at risk/)).toBeVisible();
  });

  it("offers this device's notification control", () => {
    render(<NotificationsStepPage />);
    expect(screen.getByText("device-toggle")).toBeInTheDocument();
  });

  it("can be skipped: Continue links to /today", () => {
    render(<NotificationsStepPage />);
    expect(screen.getByRole("link", { name: "Continue" })).toHaveAttribute(
      "href",
      "/today",
    );
  });
});

describe("step 3's step-1 guard", () => {
  it("sends a user who hasn't finished step 1 back to /onboarding", async () => {
    getMyProfile.mockResolvedValue({ profile: { onboarded_at: null } });
    await expect(guard()()).rejects.toBeInstanceOf(RedirectError);
    expect(redirect).toHaveBeenCalledExactlyOnceWith("/onboarding");
  });

  it("renders nothing and doesn't redirect once onboarded", async () => {
    await expect(guard()()).resolves.toBeNull();
    expect(getMyProfile).toHaveBeenCalledOnce();
    expect(redirect).not.toHaveBeenCalled();
  });

  it("doesn't redirect when the profile lookup returns null (failed)", async () => {
    getMyProfile.mockResolvedValue(null);
    await expect(guard()()).resolves.toBeNull();
    expect(redirect).not.toHaveBeenCalled();
  });

  it("lets a lookup that throws propagate rather than redirect", async () => {
    getMyProfile.mockRejectedValue(new Error("db down"));
    await expect(guard()()).rejects.toThrow("db down");
    expect(redirect).not.toHaveBeenCalled();
  });
});
