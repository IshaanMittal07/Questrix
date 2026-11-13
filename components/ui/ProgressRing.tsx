import { useId, type ReactNode } from "react";
import { cn } from "@/lib/cn";

type ProgressRingProps = {
  /** 0..max */
  value: number;
  max?: number;
  size?: number;
  strokeWidth?: number;
  label: string;
  children?: ReactNode;
  className?: string;
};

/** Circular progress (e.g. level XP). Exposes progressbar semantics. */
export function ProgressRing({
  value,
  max = 100,
  size = 64,
  strokeWidth = 6,
  label,
  children,
  className,
}: ProgressRingProps) {
  const gradId = useId();
  const clamped = Math.min(Math.max(value, 0), max);
  const r = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * r;
  const offset = circumference * (1 - (max > 0 ? clamped / max : 0));

  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={clamped}
      className={cn("relative inline-grid place-items-center", className)}
      style={{ width: size, height: size }}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        aria-hidden="true"
        className="-rotate-90"
      >
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#22E5FF" />
            <stop offset="0.5" stopColor="#8B5CFF" />
            <stop offset="1" stopColor="#FF3DCB" />
          </linearGradient>
        </defs>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--surface-2)"
          strokeWidth={strokeWidth}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={`url(#${gradId})`}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="transition-[stroke-dashoffset] duration-500 ease-out"
        />
      </svg>
      {children ? (
        <div className="absolute inset-0 grid place-items-center text-sm font-bold">
          {children}
        </div>
      ) : null}
    </div>
  );
}
