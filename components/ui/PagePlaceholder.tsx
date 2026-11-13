import type { ReactNode } from "react";
import { Card } from "@/components/ui/Card";

export function PagePlaceholder({
  title,
  phase,
  children,
}: {
  title: string;
  phase: number;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold tracking-wider uppercase">{title}</h1>
      {children}
      <Card>
        <p className="text-muted text-sm">Coming in Phase {phase}.</p>
      </Card>
    </div>
  );
}
