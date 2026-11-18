/**
 * When the user may next change their timezone (#28 cooldown), formatted in
 * their current timezone, or null if they may change it now. Display only:
 * the profiles trigger enforces the cooldown (QX001) with the same rule,
 * `timezone_changed_at + cooldown_days`, rounded up to the minute.
 */
export function timezoneCooldownUntil(
  changedAt: string | null,
  cooldownDays: number,
  now: Date,
  timezone: string,
): string | null {
  if (!changedAt || cooldownDays <= 0) return null;
  const until = new Date(Date.parse(changedAt) + cooldownDays * 86_400_000);
  if (Number.isNaN(until.getTime()) || until <= now) return null;
  // Round up to the minute, as the server's hint does, so retrying then works.
  const ms = until.getTime();
  const rounded = new Date(Math.ceil(ms / 60_000) * 60_000);
  try {
    return format(rounded, timezone);
  } catch {
    // An unknown zone (the DB validates it, so this shouldn't happen).
    return null;
  }
}

function format(date: Date, timezone: string) {
  return new Intl.DateTimeFormat("en", {
    timeZone: timezone,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
}
