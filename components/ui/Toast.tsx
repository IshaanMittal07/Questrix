"use client";

import { Toast as RadixToast } from "radix-ui";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { cn } from "@/lib/cn";

type Tone = "info" | "success" | "danger";
type ToastItem = {
  id: number;
  title: string;
  description?: string;
  tone: Tone;
};
type ToastInput = Omit<ToastItem, "id" | "tone"> & { tone?: Tone };

const ToastContext = createContext<((t: ToastInput) => void) | null>(null);

const toneClass: Record<Tone, string> = {
  info: "border-cyan/40",
  success: "border-success/50",
  danger: "border-danger/60",
};

let nextId = 1;

/** Radix Toast provider + viewport. Use `useToast()` to show a toast. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const show = useCallback((t: ToastInput) => {
    setToasts((prev) => [...prev, { tone: "info", ...t, id: nextId++ }]);
  }, []);

  const remove = (id: number) =>
    setToasts((prev) => prev.filter((t) => t.id !== id));

  const value = useMemo(() => show, [show]);

  return (
    <ToastContext.Provider value={value}>
      <RadixToast.Provider swipeDirection="down" duration={4000}>
        {children}
        {toasts.map((t) => (
          <RadixToast.Root
            key={t.id}
            onOpenChange={(open) => {
              if (!open) remove(t.id);
            }}
            className={cn(
              "bg-surface-2 rounded-2xl border p-4 shadow-xl data-[state=open]:animate-[qx-fade-in_150ms_ease-out]",
              toneClass[t.tone],
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <RadixToast.Title className="text-sm font-semibold">
                  {t.title}
                </RadixToast.Title>
                {t.description ? (
                  <RadixToast.Description className="text-muted mt-1 text-sm">
                    {t.description}
                  </RadixToast.Description>
                ) : null}
              </div>
              <RadixToast.Close
                aria-label="Dismiss"
                className="text-muted hover:text-text -m-2 grid size-11 shrink-0 place-items-center rounded-full"
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  aria-hidden="true"
                >
                  <path d="M6 6l12 12M18 6 6 18" />
                </svg>
              </RadixToast.Close>
            </div>
          </RadixToast.Root>
        ))}
        <RadixToast.Viewport className="fixed inset-x-0 bottom-[calc(var(--tabbar-height)+env(safe-area-inset-bottom)+0.75rem)] z-[90] mx-auto flex w-full max-w-md flex-col gap-2 px-4 outline-none" />
      </RadixToast.Provider>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}
