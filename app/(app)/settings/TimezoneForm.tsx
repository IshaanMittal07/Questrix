"use client";

import { useActionState, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { deviceTimezone } from "@/lib/validation/profile";
import { updateTimezone, type SettingsState } from "./actions";

function withValues(list: string[], ...extra: string[]) {
  const out = [...list];
  for (const v of extra) if (!out.includes(v)) out.unshift(v);
  return out;
}

export function TimezoneForm({
  current,
  lockedUntil = null,
}: {
  current: string;
  /** When the #28 cooldown ends (formatted), or null if a change is allowed. */
  lockedUntil?: string | null;
}) {
  const [state, action, pending] = useActionState<SettingsState, FormData>(
    updateTimezone,
    {},
  );
  const [value, setValue] = useState(current);
  // Built on the client only: the server's ICU list can differ (hydration).
  const [zones, setZones] = useState<string[]>([current]);
  useEffect(() => {
    const list =
      typeof Intl.supportedValuesOf === "function"
        ? Intl.supportedValuesOf("timeZone")
        : [];
    // eslint-disable-next-line react-hooks/set-state-in-effect -- browser-only data
    setZones(withValues(list, current, deviceTimezone()));
  }, [current]);

  return (
    <form action={action} className="flex flex-col gap-3">
      <label htmlFor="timezone" className="text-sm font-semibold">
        Timezone
      </label>
      <p className="text-muted -mt-2 text-sm">
        Your day (and your streak) resets at midnight here.
      </p>
      {lockedUntil ? (
        <p id="timezone-cooldown" className="text-warning -mt-1 text-sm">
          You changed your timezone recently. You can change it again from{" "}
          {lockedUntil}.
        </p>
      ) : null}
      <select
        id="timezone"
        name="timezone"
        value={value}
        aria-describedby={lockedUntil ? "timezone-cooldown" : undefined}
        onChange={(e) => setValue(e.target.value)}
        className="bg-surface-2 text-text min-h-12 rounded-xl border border-white/10 px-3"
      >
        {zones.map((z) => (
          <option key={z} value={z}>
            {z.replaceAll("_", " ")}
          </option>
        ))}
      </select>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => setValue(deviceTimezone())}>
          Use this device&apos;s timezone
        </Button>
        <Button
          type="submit"
          disabled={pending || value === current || lockedUntil !== null}
        >
          {pending ? "Saving…" : "Save"}
        </Button>
      </div>
      <p aria-live="polite" className="min-h-5 text-sm">
        {state.error ? (
          <span className="text-danger">{state.error}</span>
        ) : state.ok ? (
          <span className="text-success">Saved.</span>
        ) : null}
      </p>
    </form>
  );
}
