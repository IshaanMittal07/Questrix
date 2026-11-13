"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** sessionStorage key: the splash plays once per browser session. */
export const SPLASH_KEY = "qx-splash-seen";

/**
 * Runs in <head> before first paint. If the splash was already seen this
 * session, mark <html> so CSS hides the server-rendered overlay (no flash).
 */
export const SPLASH_HEAD_SCRIPT = `try{if(sessionStorage.getItem("${SPLASH_KEY}"))document.documentElement.dataset.splash="seen"}catch(e){}`;

const WORD = "QUESTRIX";
const GLYPHS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#%&";
export const SPLASH_TOTAL_MS = 2400;
export const SPLASH_REDUCED_MS = 800; // 600 ms static + 200 ms fade
/**
 * CSS owns the timeline: the splash closes on the overlay's `qx-out`
 * animationend. This timer is only a safety net (e.g. animation events not
 * delivered), so it gets slack for a late first paint.
 */
export const SPLASH_FALLBACK_GRACE_MS = 600;
const SCRAMBLE_TICK_MS = 40;
const FIRST_LOCK_MS = 300; // after scramble start
const LOCK_STAGGER_MS = 50;
const SCRAMBLE_END_MS = FIRST_LOCK_MS + (WORD.length - 1) * LOCK_STAGGER_MS;

/** Wordmark text `elapsed` ms after the scramble started. Exported for tests. */
export function scrambleFrame(elapsed: number, rand = Math.random): string {
  let out = "";
  for (let i = 0; i < WORD.length; i++) {
    out +=
      elapsed >= FIRST_LOCK_MS + i * LOCK_STAGGER_MS
        ? WORD[i]
        : GLYPHS[Math.floor(rand() * GLYPHS.length)];
  }
  return out;
}

function prefersReducedMotion() {
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export function LaunchSplash() {
  const [visible, setVisible] = useState(true);
  const [text, setText] = useState(WORD);
  const scrambleRef = useRef<ReturnType<typeof setInterval> | undefined>(
    undefined,
  );

  const finish = useCallback(() => {
    document.documentElement.dataset.splash = "seen";
    setVisible(false);
  }, []);

  /** Started by the wordmark's CSS reveal, so it stays in sync with paint. */
  const startScramble = useCallback(() => {
    if (scrambleRef.current !== undefined || prefersReducedMotion()) return;
    let elapsed = 0;
    setText(scrambleFrame(0));
    scrambleRef.current = setInterval(() => {
      elapsed += SCRAMBLE_TICK_MS;
      if (elapsed >= SCRAMBLE_END_MS) {
        clearInterval(scrambleRef.current);
        setText(WORD);
      } else {
        setText(scrambleFrame(elapsed));
      }
    }, SCRAMBLE_TICK_MS);
  }, []);

  useEffect(() => {
    // Once hidden, this effect's cleanup has already removed the key listener
    // and cleared every timer; nothing is left running for the session.
    if (!visible) return;
    if (document.documentElement.dataset.splash === "seen") {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- sync with the pre-hydration flag
      setVisible(false);
      return;
    }
    try {
      sessionStorage.setItem(SPLASH_KEY, "1");
    } catch {
      // Storage disabled (e.g. private mode): the splash plays on every load.
    }

    // Fallback only: measured from navigation start so late hydration can't
    // extend the overlay, plus grace for a late first paint of the CSS.
    const base = prefersReducedMotion() ? SPLASH_REDUCED_MS : SPLASH_TOTAL_MS;
    const fallback = setTimeout(
      finish,
      Math.max(0, base - performance.now()) + SPLASH_FALLBACK_GRACE_MS,
    );

    window.addEventListener("keydown", finish);
    return () => {
      clearTimeout(fallback);
      clearInterval(scrambleRef.current);
      window.removeEventListener("keydown", finish);
    };
  }, [finish, visible]);

  if (!visible) return null;

  return (
    <div
      className="qx-splash"
      data-testid="launch-splash"
      // `click` (not pointerdown) so the same tap can't fall through to
      // whatever is under the overlay once it unmounts (ghost click).
      onClick={finish}
      onAnimationStart={(e) => {
        if (e.animationName === "qx-in") startScramble();
      }}
      onAnimationEnd={(e) => {
        if (e.target === e.currentTarget && e.animationName === "qx-out") {
          finish();
        }
      }}
    >
      <p className="sr-only" role="status" aria-live="polite">
        Loading Questrix
      </p>
      <div aria-hidden="true" data-testid="launch-splash-art">
        <div className="qx-splash__scanlines" />
        <div className="qx-splash__grid" />
        <div className="qx-splash__stage">
          <svg
            className="qx-splash__icon"
            viewBox="0 0 512 512"
            xmlns="http://www.w3.org/2000/svg"
          >
            <defs>
              <linearGradient id="qxs-grad" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#22E5FF" />
                <stop offset="0.5" stopColor="#8B5CFF" />
                <stop offset="1" stopColor="#FF3DCB" />
              </linearGradient>
              <filter
                id="qxs-glow"
                x="-30%"
                y="-30%"
                width="160%"
                height="160%"
              >
                <feGaussianBlur stdDeviation="8" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
              <radialGradient id="qxs-burst">
                <stop offset="0" stopColor="#FFFFFF" stopOpacity="0.9" />
                <stop offset="0.4" stopColor="#22E5FF" stopOpacity="0.5" />
                <stop offset="1" stopColor="#8B5CFF" stopOpacity="0" />
              </radialGradient>
            </defs>
            <polygon
              className="qx-splash__hex"
              points="256,56 429.2,156 429.2,356 256,456 82.8,356 82.8,156"
              fill="none"
              stroke="url(#qxs-grad)"
              strokeWidth="22"
              strokeLinejoin="round"
              filter="url(#qxs-glow)"
            />
            <path
              className="qx-splash__pulse"
              d="M132 300 H190 L218 246 L252 332 L298 176 L328 248 H380"
              fill="none"
              stroke="url(#qxs-grad)"
              strokeWidth="22"
              strokeLinecap="round"
              strokeLinejoin="round"
              filter="url(#qxs-glow)"
            />
            <circle
              className="qx-splash__burst"
              cx="298"
              cy="176"
              r="40"
              fill="url(#qxs-burst)"
            />
            <circle
              className="qx-splash__spark"
              cx="298"
              cy="176"
              r="14"
              fill="#FFFFFF"
              filter="url(#qxs-glow)"
            />
          </svg>
          <span className="qx-splash__wordmark" data-testid="splash-wordmark">
            {text}
          </span>
          <span className="qx-splash__tagline">Level up your real life.</span>
        </div>
      </div>
    </div>
  );
}
