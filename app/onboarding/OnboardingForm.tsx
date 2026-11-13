"use client";

import { useActionState, useEffect, useState } from "react";
import { Avatar } from "@/components/avatar/Avatar";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import { createClient } from "@/lib/supabase/client";
import { usernameSchema } from "@/lib/validation/profile";
import { completeOnboarding, type OnboardingState } from "./actions";

type Base = { id: string; name: string; svg: string | null };
type Availability = "idle" | "checking" | "available" | "taken" | "invalid";

export function OnboardingForm({ avatarBases }: { avatarBases: Base[] }) {
  const [state, formAction, pending] = useActionState<
    OnboardingState,
    FormData
  >(completeOnboarding, {});
  const [username, setUsername] = useState("");
  const [availability, setAvailability] = useState<Availability>("idle");
  const [hint, setHint] = useState<string | null>(null);
  const [baseId, setBaseId] = useState(avatarBases[0]?.id ?? "");
  const [timezone] = useState(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  );

  // Debounced availability check while typing.
  useEffect(() => {
    if (!username) return;
    const parsed = usernameSchema.safeParse(username);
    if (!parsed.success) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- derived from the input
      setAvailability("invalid");
      setHint(parsed.error.issues[0].message);
      return;
    }
    setAvailability("checking");
    setHint(null);
    const handle = setTimeout(async () => {
      const { data } = await createClient().rpc("username_available", {
        p_username: parsed.data,
      });
      setAvailability(data ? "available" : "taken");
      setHint(data ? "Available!" : "Taken — try another");
    }, 350);
    return () => clearTimeout(handle);
  }, [username]);

  const selectedSvg = avatarBases.find((b) => b.id === baseId)?.svg ?? null;
  const usernameError =
    state.field === "username"
      ? state.error
      : availability === "taken" || availability === "invalid"
        ? hint
        : null;

  return (
    <form action={formAction} className="flex flex-col gap-6">
      <div className="flex justify-center">
        <Avatar
          size={128}
          label="Your avatar preview"
          layers={{
            background: "/cosmetics/background/grid-void.svg",
            border: "/cosmetics/border/plain.svg",
            avatarBase: selectedSvg,
            outfit: "/cosmetics/outfit/starter-tee.svg",
          }}
        />
      </div>

      <fieldset>
        <legend className="mb-2 text-sm font-semibold">Avatar</legend>
        <div className="grid grid-cols-4 gap-3">
          {avatarBases.map((b) => (
            <label
              key={b.id}
              className={cn(
                "bg-surface-2 has-[:focus-visible]:outline-cyan flex cursor-pointer flex-col items-center gap-1 rounded-2xl border-2 p-2 text-xs has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2",
                baseId === b.id ? "border-cyan" : "border-transparent",
              )}
            >
              <input
                type="radio"
                name="avatarBaseId"
                value={b.id}
                checked={baseId === b.id}
                onChange={() => setBaseId(b.id)}
                className="sr-only"
              />
              <Avatar size={56} layers={{ avatarBase: b.svg }} />
              {b.name}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="flex flex-col gap-2">
        <label htmlFor="username" className="text-sm font-semibold">
          Username
        </label>
        <div className="relative">
          <span className="text-muted pointer-events-none absolute top-1/2 left-4 -translate-y-1/2">
            @
          </span>
          <input
            id="username"
            name="username"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            required
            minLength={3}
            maxLength={20}
            value={username}
            onChange={(e) => setUsername(e.target.value.toLowerCase())}
            className="bg-surface-2 text-text min-h-12 w-full rounded-xl border border-white/10 pr-4 pl-8"
            aria-invalid={usernameError ? true : undefined}
            aria-describedby="username-hint"
          />
        </div>
        <p
          id="username-hint"
          aria-live="polite"
          className={cn(
            "min-h-5 text-sm",
            usernameError
              ? "text-danger"
              : availability === "available"
                ? "text-success"
                : "text-muted",
          )}
        >
          {usernameError ??
            (availability === "checking"
              ? "Checking…"
              : availability === "available"
                ? hint
                : "3–20 characters: a–z, 0–9 and _")}
        </p>
      </div>

      <input type="hidden" name="timezone" value={timezone} />
      <p className="text-muted -mt-3 text-xs">
        Timezone: {timezone} (change it later in Settings)
      </p>

      {state.field === "form" && state.error ? (
        <p role="alert" className="text-danger text-sm">
          {state.error}
        </p>
      ) : null}

      <Button
        type="submit"
        size="lg"
        disabled={
          pending ||
          availability === "taken" ||
          availability === "invalid" ||
          !username
        }
      >
        {pending ? "Saving…" : "Start my quest"}
      </Button>
    </form>
  );
}
