"use client";

import { useEffect } from "react";
import { markInboxRead } from "@/lib/social/actions";

/** Marks the inbox read once it has been shown (the badge clears next visit). */
export function MarkRead() {
  useEffect(() => {
    void markInboxRead();
  }, []);
  return null;
}
