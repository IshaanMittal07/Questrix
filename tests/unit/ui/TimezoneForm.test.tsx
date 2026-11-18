import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/(app)/settings/actions", () => ({
  updateTimezone: vi.fn(async () => ({})),
}));

const { TimezoneForm } = await import("@/app/(app)/settings/TimezoneForm");

describe("TimezoneForm cooldown note", () => {
  it("describes the select with the cooldown when locked", () => {
    render(
      <TimezoneForm current="Asia/Kolkata" lockedUntil="Wed, Nov 25, 16:00" />,
    );
    const select = screen.getByRole("combobox", { name: "Timezone" });
    expect(select).toHaveAttribute("aria-describedby", "timezone-cooldown");
    expect(select).toHaveAccessibleDescription(
      "You changed your timezone recently. You can change it again from Wed, Nov 25, 16:00.",
    );
  });

  it("has no note or description when a change is allowed", () => {
    render(<TimezoneForm current="Asia/Kolkata" />);
    const select = screen.getByRole("combobox", { name: "Timezone" });
    expect(select).not.toHaveAttribute("aria-describedby");
    expect(screen.queryByText(/changed your timezone recently/)).toBeNull();
  });

  it("treats lockedUntil = null as unlocked", () => {
    render(<TimezoneForm current="UTC" lockedUntil={null} />);
    expect(
      screen.getByRole("combobox", { name: "Timezone" }),
    ).not.toHaveAttribute("aria-describedby");
  });

  it("disables Save during the cooldown", () => {
    render(<TimezoneForm current="UTC" lockedUntil="Wed, Nov 25, 16:00" />);
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });
});
