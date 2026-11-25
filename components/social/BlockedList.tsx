"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { setBlocked } from "@/lib/social/actions";

/** Settings → Blocked users, with Unblock (a blocked profile can't be opened). */
export function BlockedList({
  initial,
}: {
  initial: { userId: string; username: string }[];
}) {
  const [users, setUsers] = useState(initial);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();

  return (
    <section aria-labelledby="blocked-h" className="flex flex-col gap-2">
      <h2 id="blocked-h" className="font-semibold">
        Blocked users
      </h2>
      {users.length === 0 ? (
        <p className="text-muted text-sm">You haven&apos;t blocked anyone.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {users.map((u) => (
            <li
              key={u.userId}
              className="flex items-center justify-between gap-2"
            >
              <span>@{u.username}</span>
              <Button
                variant="secondary"
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    setError("");
                    const res = await setBlocked(u.userId, false);
                    if (!res.ok) return setError(res.error);
                    setUsers((us) => us.filter((x) => x.userId !== u.userId));
                    setStatus(`Unblocked @${u.username}.`);
                  })
                }
              >
                Unblock<span className="sr-only"> @{u.username}</span>
              </Button>
            </li>
          ))}
        </ul>
      )}
      <p role="status" aria-live="polite" className="sr-only">
        {status}
      </p>
      {error ? (
        <p role="alert" className="text-danger text-sm">
          {error}
        </p>
      ) : null}
    </section>
  );
}
