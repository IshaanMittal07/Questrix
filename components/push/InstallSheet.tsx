"use client";

import { Button } from "@/components/ui/Button";
import { Sheet } from "@/components/ui/Sheet";

/**
 * iPhone in a Safari tab: push only works in the installed app (iOS 16.4+),
 * so explain how to install it first (plan §7.1).
 */
export function InstallSheet() {
  return (
    <div className="flex flex-col items-start gap-2">
      <p className="text-muted text-sm">
        On iPhone, notifications work once Questrix is on your Home Screen.
      </p>
      <Sheet
        title="Install Questrix"
        description="Add it to your Home Screen to get reminders."
        trigger={<Button variant="secondary">How to install</Button>}
      >
        <ol className="flex list-decimal flex-col gap-2 pl-5 text-sm">
          <li>
            Tap the <strong>Share</strong> button in Safari&apos;s toolbar.
          </li>
          <li>
            Choose <strong>Add to Home Screen</strong>, then{" "}
            <strong>Add</strong>.
          </li>
          <li>Open Questrix from your Home Screen.</li>
          <li>
            Go to Settings and tap <strong>Enable notifications</strong>.
          </li>
        </ol>
        <p className="text-muted mt-3 text-xs">Needs iOS 16.4 or later.</p>
      </Sheet>
    </div>
  );
}
