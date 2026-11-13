"use client";

import { Tabs as RadixTabs } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";

/** Accessible in-page tabs (Radix: arrow-key navigation, aria-selected). */
export const Tabs = RadixTabs.Root;

export function TabsList({
  className,
  ...props
}: ComponentProps<typeof RadixTabs.List>) {
  return (
    <RadixTabs.List
      className={cn(
        "bg-surface-2 inline-flex w-full gap-1 rounded-full p-1",
        className,
      )}
      {...props}
    />
  );
}

export function TabsTrigger({
  className,
  ...props
}: ComponentProps<typeof RadixTabs.Trigger>) {
  return (
    <RadixTabs.Trigger
      className={cn(
        "text-muted data-[state=active]:bg-surface data-[state=active]:text-text min-h-11 flex-1 rounded-full px-3 text-sm font-semibold transition-colors",
        className,
      )}
      {...props}
    />
  );
}

export function TabsContent({
  className,
  ...props
}: ComponentProps<typeof RadixTabs.Content>) {
  return <RadixTabs.Content className={cn("mt-4", className)} {...props} />;
}
