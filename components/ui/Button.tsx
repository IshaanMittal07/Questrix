import { Slot } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "md" | "lg" | "icon";

const variants: Record<Variant, string> = {
  // Dark text on the gradient: white on violet fails WCAG AA.
  primary: "bg-brand text-bg shadow-[0_0_24px_-6px_var(--neon-violet)]",
  secondary: "bg-surface-2 text-text border border-white/10",
  ghost: "bg-transparent text-text hover:bg-white/5",
  danger: "bg-danger text-bg",
};

const sizes: Record<Size, string> = {
  md: "min-h-11 px-4 text-sm",
  lg: "min-h-12 px-6 text-base",
  icon: "size-11",
};

export type ButtonProps = ComponentProps<"button"> & {
  variant?: Variant;
  size?: Size;
  /** Render the child element (e.g. a Link) with button styles. */
  asChild?: boolean;
};

export function Button({
  variant = "primary",
  size = "md",
  asChild = false,
  className,
  type,
  ...props
}: ButtonProps) {
  const Comp = asChild ? Slot.Root : "button";
  return (
    <Comp
      type={asChild ? undefined : (type ?? "button")}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-full font-semibold transition-[transform,opacity] select-none active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50",
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    />
  );
}
