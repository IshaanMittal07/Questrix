"use client";

import { useEffect } from "react";
import { markInboxRead } from "@/lib/social/actions";

/**
 * Marks the inbox read once it has been shown (the badge clears next visit),
 * up to the newest item shown: later arrivals stay unread.
 */
export function MarkRead({ through }: { through: string }) {
  useEffect(() => {
    void markInboxRead(through);
  }, [through]);
  return null;
}
