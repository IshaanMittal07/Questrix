"use client";

import { useId } from "react";
import { cn } from "@/lib/cn";

type SwitchProps = {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
  id?: string;
  /** A decorative emoji shown before the label, not part of the name. */
  icon?: string | null;
};

/**
 * A labelled on/off switch: a button with role="switch" and aria-checked,
 * toggled by click, Space or Enter. The whole row is the hit target (44 px).
 */
export function Switch({
  checked,
  onCheckedChange,
  label,
  description,
  disabled,
  id: idProp,
  icon,
}: SwitchProps) {
  // Always an id, so the name is the label alone even without one passed.
  const generated = useId();
  const id = idProp ?? generated;
  const descId = description ? `${id}-desc` : undefined;
  const labelId = `${id}-label`;
  return (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={checked}
      // The name is the label alone; the description is read once, as a
      // description (not twice, as part of the name too).
      aria-labelledby={labelId}
      aria-describedby={descId}
      aria-disabled={disabled || undefined}
      onClick={() => {
        if (!disabled) onCheckedChange(!checked);
      }}
      className={cn(
        "flex min-h-11 w-full items-center justify-between gap-4 rounded-xl text-left",
        "focus-visible:outline-cyan focus-visible:outline-2 focus-visible:outline-offset-2",
        disabled && "opacity-60",
      )}
    >
      <span className="min-w-0">
        <span className="block font-medium">
          {icon ? <span aria-hidden="true">{icon} </span> : null}
          <span id={labelId}>{label}</span>
        </span>
        {description ? (
          <span id={descId} className="text-muted block text-sm">
            {description}
          </span>
        ) : null}
      </span>
      <span
        aria-hidden="true"
        className={cn(
          "relative h-7 w-12 shrink-0 rounded-full transition-colors motion-reduce:transition-none",
          checked ? "bg-cyan" : "bg-white/15",
        )}
      >
        <span
          className={cn(
            "absolute top-1 left-1 size-5 rounded-full bg-white transition-transform motion-reduce:transition-none",
            checked && "translate-x-5",
          )}
        />
      </span>
    </button>
  );
}
