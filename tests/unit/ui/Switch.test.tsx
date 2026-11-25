import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { Switch } from "@/components/ui/Switch";

describe("Switch", () => {
  it("is a switch named by its label, reflecting checked", () => {
    const { rerender } = render(
      <Switch label="Streak saver" checked={false} onCheckedChange={vi.fn()} />,
    );
    const sw = screen.getByRole("switch", { name: "Streak saver" });
    expect(sw).toHaveAttribute("aria-checked", "false");
    expect(sw).toHaveAttribute("type", "button");
    expect(sw).not.toHaveAttribute("aria-disabled");
    rerender(<Switch label="Streak saver" checked onCheckedChange={vi.fn()} />);
    expect(sw).toHaveAttribute("aria-checked", "true");
  });

  it.each([
    [false, true],
    [true, false],
  ])("a click on %s asks for %s", async (checked, next) => {
    const onChange = vi.fn();
    render(
      <Switch label="Reminders" checked={checked} onCheckedChange={onChange} />,
    );
    await userEvent.click(screen.getByRole("switch"));
    expect(onChange).toHaveBeenCalledExactlyOnceWith(next);
  });

  it("toggles from the keyboard (Space and Enter)", async () => {
    const onChange = vi.fn();
    render(
      <Switch label="Reminders" checked={false} onCheckedChange={onChange} />,
    );
    screen.getByRole("switch").focus();
    await userEvent.keyboard(" ");
    await userEvent.keyboard("{Enter}");
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onChange).toHaveBeenNthCalledWith(1, true);
  });

  it("when disabled, stays focusable but doesn't toggle", async () => {
    const onChange = vi.fn();
    render(
      <Switch
        label="Streak saver"
        checked={false}
        disabled
        onCheckedChange={onChange}
      />,
    );
    const sw = screen.getByRole("switch", { name: "Streak saver" });
    expect(sw).toHaveAttribute("aria-disabled", "true");
    // aria-disabled, not disabled: still reachable by screen readers.
    expect(sw).toBeEnabled();
    await userEvent.click(sw);
    sw.focus();
    await userEvent.keyboard(" ");
    expect(onChange).not.toHaveBeenCalled();
    expect(sw).toHaveAttribute("aria-checked", "false");
  });

  it("links the description with aria-describedby", () => {
    render(
      <Switch
        id="streak-saver"
        label="Streak saver"
        description="A nudge at 20:00."
        checked={false}
        onCheckedChange={vi.fn()}
      />,
    );
    const sw = screen.getByRole("switch", { name: /^Streak saver/ });
    expect(sw).toHaveAttribute("id", "streak-saver");
    expect(sw).toHaveAttribute("aria-describedby", "streak-saver-desc");
    expect(sw).toHaveAccessibleDescription("A nudge at 20:00.");
  });

  it("has no aria-describedby without a description or without an id", () => {
    render(
      <>
        <Switch id="a" label="A" checked={false} onCheckedChange={vi.fn()} />
        <Switch
          label="B"
          description="No id to link by"
          checked={false}
          onCheckedChange={vi.fn()}
        />
      </>,
    );
    for (const sw of screen.getAllByRole("switch")) {
      expect(sw).not.toHaveAttribute("aria-describedby");
    }
    // The description still shows, just unlinked.
    expect(screen.getByText("No id to link by")).toBeInTheDocument();
  });
});
