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

  it("links the description with aria-describedby; the name is the label alone", () => {
    render(
      <Switch
        id="streak-saver"
        label="Streak saver"
        description="A nudge at 20:00."
        checked={false}
        onCheckedChange={vi.fn()}
      />,
    );
    const sw = screen.getByRole("switch", { name: "Streak saver" });
    expect(sw).toHaveAttribute("id", "streak-saver");
    expect(sw).toHaveAttribute("aria-labelledby", "streak-saver-label");
    expect(sw).toHaveAttribute("aria-describedby", "streak-saver-desc");
    expect(sw).toHaveAccessibleName("Streak saver");
    expect(sw).toHaveAccessibleDescription("A nudge at 20:00.");
  });

  it("generates an id when none is passed, so labelling still works", () => {
    render(
      <>
        <Switch
          label="B"
          description="Linked by a generated id"
          checked={false}
          onCheckedChange={vi.fn()}
        />
        <Switch
          label="C"
          description="Another"
          checked={false}
          onCheckedChange={vi.fn()}
        />
      </>,
    );
    const [b, c] = screen.getAllByRole("switch");
    expect(b!.id).not.toBe("");
    expect(b!.id).not.toBe(c!.id);
    expect(b).toHaveAttribute("aria-labelledby", `${b!.id}-label`);
    expect(b).toHaveAttribute("aria-describedby", `${b!.id}-desc`);
    expect(b).toHaveAccessibleName("B");
    expect(b).toHaveAccessibleDescription("Linked by a generated id");
    expect(c).toHaveAccessibleName("C");
    expect(c).toHaveAccessibleDescription("Another");
  });

  it("has no aria-describedby without a description", () => {
    render(
      <Switch id="a" label="A" checked={false} onCheckedChange={vi.fn()} />,
    );
    const sw = screen.getByRole("switch", { name: "A" });
    expect(sw).not.toHaveAttribute("aria-describedby");
    expect(sw).toHaveAttribute("aria-labelledby", "a-label");
  });

  it("shows an icon outside the name, hidden from assistive tech", () => {
    const { container } = render(
      <Switch
        id="w"
        label="Water"
        icon="W"
        checked={false}
        onCheckedChange={vi.fn()}
      />,
    );
    const sw = screen.getByRole("switch", { name: "Water" });
    expect(sw).toHaveTextContent(/^W\s*Water/);
    const icon = container.querySelector('[aria-hidden="true"]');
    expect(icon).toHaveTextContent("W");
    expect(icon).not.toContainElement(document.getElementById("w-label"));
  });

  it.each([null, undefined, ""])("renders no icon for %o", (icon) => {
    const { container } = render(
      <Switch
        label="Read"
        icon={icon}
        checked={false}
        onCheckedChange={vi.fn()}
      />,
    );
    // Only the track is aria-hidden.
    expect(container.querySelectorAll('[aria-hidden="true"]')).toHaveLength(1);
    expect(screen.getByRole("switch")).toHaveTextContent(/^Read$/);
  });
});
