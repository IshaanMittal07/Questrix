"use client";

import { useEffect, useRef, useState } from "react";

/** Public Turnstile site key. Unset (local dev, CI) → no CAPTCHA is rendered. */
export const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

type TurnstileApi = {
  render: (
    el: HTMLElement,
    opts: {
      sitekey: string;
      theme?: "dark" | "light" | "auto";
      callback: (token: string) => void;
      "expired-callback": () => void;
      "error-callback": () => void;
    },
  ) => string;
  reset: (id: string) => void;
  remove: (id: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT_SRC =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

function loadScript(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  return new Promise((resolve, reject) => {
    let script = document.querySelector<HTMLScriptElement>(
      `script[src="${SCRIPT_SRC}"]`,
    );
    if (!script) {
      script = document.createElement("script");
      script.src = SCRIPT_SRC;
      script.async = true;
      document.head.appendChild(script);
    }
    // Drop a failed tag (blocked, or a blocker's stub that defines nothing) so
    // the next mount retries instead of waiting forever on a script that will
    // never fire load/error again.
    const fail = () => {
      script!.remove();
      reject(new Error("load"));
    };
    script.addEventListener("load", () =>
      window.turnstile ? resolve(window.turnstile) : fail(),
    );
    script.addEventListener("error", fail);
  });
}

/**
 * Cloudflare Turnstile widget. Supabase Auth checks the token on sign-in/sign-up
 * requests once CAPTCHA is enabled for the project (see docs/RUNBOOK.md).
 * Tokens are single-use: bump `resetKey` after each request to get a new one.
 */
export function Turnstile({
  onToken,
  resetKey,
}: {
  onToken: (token: string | null) => void;
  resetKey: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  // "load": the script was blocked; "widget": the challenge itself errored.
  const [failure, setFailure] = useState<"load" | "widget" | null>(null);
  const onTokenRef = useRef(onToken);
  useEffect(() => {
    onTokenRef.current = onToken;
  });

  useEffect(() => {
    if (!TURNSTILE_SITE_KEY || !ref.current) return;
    const el = ref.current;
    let cancelled = false;
    loadScript()
      .then((api) => {
        if (cancelled) return;
        widgetId.current = api.render(el, {
          sitekey: TURNSTILE_SITE_KEY,
          theme: "dark",
          callback: (t) => {
            setFailure(null); // Turnstile retries on its own; clear the alert
            onTokenRef.current(t);
          },
          "expired-callback": () => onTokenRef.current(null),
          "error-callback": () => {
            if (cancelled) return;
            setFailure("widget");
            onTokenRef.current(null);
          },
        });
      })
      .catch(() => {
        if (cancelled) return;
        setFailure("load");
        onTokenRef.current(null);
      });
    return () => {
      cancelled = true;
      if (widgetId.current) window.turnstile?.remove(widgetId.current);
      widgetId.current = null;
    };
  }, []);

  useEffect(() => {
    if (resetKey > 0 && widgetId.current) {
      window.turnstile?.reset(widgetId.current);
      onTokenRef.current(null);
    }
  }, [resetKey]);

  if (!TURNSTILE_SITE_KEY) return null;
  return (
    <div className="flex flex-col items-center gap-2">
      <div ref={ref} className="flex min-h-16 justify-center" />
      {failure ? (
        <p role="alert" className="text-danger text-center text-sm">
          {failure === "load"
            ? "The security check couldn't load. Turn off content blockers for this site, or try another browser, then reload."
            : "The security check failed. Please try again."}
        </p>
      ) : null}
    </div>
  );
}
