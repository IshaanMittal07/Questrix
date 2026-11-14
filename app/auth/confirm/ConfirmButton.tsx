"use client";

import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/Button";

/** Disabled while verifying: a second submit would reuse the one-time token. */
export function ConfirmButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" disabled={pending}>
      {pending ? "Signing in…" : "Sign in to Questrix"}
    </Button>
  );
}
