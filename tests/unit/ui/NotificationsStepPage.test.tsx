import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/push/EnableNotifications", () => ({
  EnableNotifications: () => <p>device-toggle</p>,
}));

const page = await import("@/app/onboarding/notifications/page");
const NotificationsStepPage = page.default;

describe("onboarding step 3 (notifications)", () => {
  it("is titled and labelled Step 3", () => {
    expect(page.metadata).toEqual({ title: "Stay on track" });
    render(<NotificationsStepPage />);
    expect(screen.getByText("Step 3")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 1, name: "Stay on track" }),
    ).toBeInTheDocument();
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
