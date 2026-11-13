"use client";

import { Dialog } from "radix-ui";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

type SheetProps = {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Element that opens the sheet (rendered via Dialog.Trigger asChild). */
  trigger?: ReactNode;
  title: string;
  description?: string;
  children?: ReactNode;
  className?: string;
};

/** Bottom sheet built on Radix Dialog (focus trap, Esc to close, aria wiring). */
export function Sheet({
  open,
  onOpenChange,
  trigger,
  title,
  description,
  children,
  className,
}: SheetProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      {trigger ? <Dialog.Trigger asChild>{trigger}</Dialog.Trigger> : null}
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm data-[state=open]:animate-[qx-fade-in_150ms_ease-out]" />
        <Dialog.Content
          className={cn(
            "bg-surface fixed inset-x-0 bottom-0 z-50 mx-auto max-h-[85dvh] w-full max-w-lg overflow-y-auto rounded-t-3xl border-t border-white/10 p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] focus:outline-none data-[state=open]:animate-[qx-sheet-up_200ms_ease-out]",
            className,
          )}
        >
          <div
            aria-hidden="true"
            className="mx-auto mb-4 h-1.5 w-10 rounded-full bg-white/20"
          />
          <Dialog.Title className="text-lg font-bold">{title}</Dialog.Title>
          {description ? (
            <Dialog.Description className="text-muted mt-1 text-sm">
              {description}
            </Dialog.Description>
          ) : (
            <Dialog.Description className="sr-only">{title}</Dialog.Description>
          )}
          <div className="mt-4">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export const SheetClose = Dialog.Close;
