"use client";

import { useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { setPrivate } from "@/app/(app)/settings/actions";
import { Button } from "@/components/ui/Button";
import { Switch } from "@/components/ui/Switch";
import { clearOfflinePages } from "@/lib/offline/pages";

/** Privacy, data export and account deletion (plan §9 Settings). */
export function AccountCard({
  username,
  isPrivate,
}: {
  username: string;
  isPrivate: boolean;
}) {
  const [priv, setPriv] = useState(isPrivate);
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState("");
  const [, start] = useTransition();
  const params = useSearchParams();
  const deleteState = params.get("delete");

  return (
    <section aria-labelledby="account-h" className="flex flex-col gap-4">
      <h2 id="account-h" className="font-semibold">
        Privacy &amp; data
      </h2>
      <Switch
        checked={priv}
        label="Private profile"
        description="Hide your stats, heatmap and leaderboard rank from others. Your name, avatar and posts stay visible."
        onCheckedChange={(next) => {
          setPriv(next);
          setError("");
          start(async () => {
            const res = await setPrivate(next);
            if (!res.ok) {
              setPriv(!next);
              setError(res.error);
            }
          });
        }}
      />
      {error ? (
        <p role="alert" className="text-danger text-sm">
          {error}
        </p>
      ) : null}

      <Button asChild variant="secondary">
        <a href="/api/account/export" download>
          Export my data (JSON)
        </a>
      </Button>

      <details
        open={!!deleteState}
        className="rounded-xl border border-white/10 p-3"
      >
        <summary className="text-danger min-h-11 cursor-pointer content-center font-semibold">
          Delete account
        </summary>
        <form
          method="post"
          action="/api/account/delete"
          onSubmit={(e) => {
            // Clear the offline copy of Today first (DECISIONS H11).
            e.preventDefault();
            const form = e.currentTarget;
            void clearOfflinePages().then(() => form.submit());
          }}
          className="mt-3 flex flex-col gap-3"
        >
          <p className="text-muted text-sm">
            This permanently deletes your profile, habits, points, items and
            posts. It can&apos;t be undone. Type{" "}
            <strong className="text-text">{username}</strong> to confirm.
          </p>
          <label htmlFor="delete-confirm" className="sr-only">
            Type your username to confirm
          </label>
          <input
            id="delete-confirm"
            name="confirm"
            autoComplete="off"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className="bg-surface-2 min-h-11 rounded-xl px-3"
          />
          {deleteState ? (
            <p role="alert" className="text-danger text-sm">
              {deleteState === "confirm"
                ? "The username didn't match."
                : "Couldn't delete your account. Try again."}
            </p>
          ) : null}
          <Button
            type="submit"
            variant="danger"
            disabled={confirm.trim().toLowerCase() !== username.toLowerCase()}
          >
            Delete my account forever
          </Button>
        </form>
      </details>
    </section>
  );
}
