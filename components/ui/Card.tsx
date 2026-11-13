import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";

export function Card({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "bg-surface rounded-2xl border border-white/8 p-4 shadow-[0_8px_32px_-12px_rgb(0_0_0/0.6)]",
        className,
      )}
      {...props}
    />
  );
}

export function CardTitle({ className, ...props }: ComponentProps<"h2">) {
  return (
    <h2
      className={cn("text-base font-bold tracking-wide", className)}
      {...props}
    />
  );
}
