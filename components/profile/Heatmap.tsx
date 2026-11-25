import { cn } from "@/lib/cn";
import { heatLevel, type HeatCell } from "@/lib/profile/heatmap";

const SHADE = ["bg-surface-2", "bg-cyan/30", "bg-cyan/60", "bg-cyan"] as const;

export function Heatmap({ weeks }: { weeks: HeatCell[][] }) {
  const cells = weeks.flat().filter((c) => !c.future);
  const active = cells.filter((c) => c.count > 0).length;
  const total = cells.reduce((n, c) => n + c.count, 0);
  return (
    <figure className="flex flex-col gap-2">
      <figcaption className="text-muted text-xs">
        Last 12 weeks: {active} active days, {total} completions
      </figcaption>
      <div
        className="grid grid-flow-col grid-rows-7 gap-1"
        style={{
          gridTemplateColumns: `repeat(${weeks.length}, minmax(0, 1fr))`,
        }}
        aria-hidden
        data-testid="heatmap"
      >
        {weeks.flat().map((c) => (
          <span
            key={c.date}
            title={c.future ? undefined : `${c.date}: ${c.count}`}
            className={cn(
              "aspect-square rounded-[3px]",
              c.future ? "bg-transparent" : SHADE[heatLevel(c.count)],
            )}
          />
        ))}
      </div>
    </figure>
  );
}
