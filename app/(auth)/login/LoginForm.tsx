"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { TURNSTILE_SITE_KEY, Turnstile } from "@/components/auth/Turnstile";
import { Button } from "@/components/ui/Button";
import { authCallbackUrl, nextFromSearch } from "@/lib/auth/next";

/**
 * supabase-js and zod load on first use, not with the page: together they
 * are most of the login page's JavaScript, and the form needs neither until
 * it's submitted (DECISIONS H4, Lighthouse TBT).
 */
const loadClient = () => import("@/lib/supabase/client");
const loadValidation = () => import("@/lib/validation/profile");
/**
 * A chunk that fails to load (flaky network, or a deploy replaced it) would
 * leave the form stuck on "Sending"; reload to fetch fresh chunks instead.
 */
function orReload<T>(p: Promise<T>): Promise<T> {
  return p.catch((e: unknown) => {
    window.location.reload();
    throw e;
  });
}
const supabase = async () => (await orReload(loadClient())).createClient();
const emailSchema = async () => (await orReload(loadValidation())).emailSchema;
/** Warm both chunks early, so a submit rarely waits on them. */
function prefetchLoginChunks() {
  void loadClient().catch(() => {});
  void loadValidation().catch(() => {});
}

type Status =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "sent"; email: string }
  | { kind: "error"; message: string };

// Read at sign-in time rather than via useSearchParams, so the form stays in
// the static shell (cacheComponents) instead of waiting behind Suspense.
function nextPath() {
  return nextFromSearch(window.location.search);
}

function callbackUrl() {
  return authCallbackUrl(window.location.origin, nextPath());
}

export function LoginForm() {
  useEffect(() => {
    // On the first focus, tap or key press, not when the browser goes idle:
    // evaluating supabase-js then still blocked the main thread inside
    // Lighthouse's window (mobile TBT, #110). Typing an email takes longer
    // than the chunks take to load.
    const events = ["focusin", "pointerdown", "keydown"] as const;
    const warm = () => {
      events.forEach((t) => window.removeEventListener(t, warm, true));
      prefetchLoginChunks();
    };
    events.forEach((t) =>
      window.addEventListener(t, warm, { capture: true, passive: true }),
    );
    return () =>
      events.forEach((t) => window.removeEventListener(t, warm, true));
  }, []);
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaReset, setCaptchaReset] = useState(0);

  async function sendMagicLink(e: FormEvent) {
    e.preventDefault();
    const parsed = (await emailSchema()).safeParse(email);
    if (!parsed.success) {
      setStatus({ kind: "error", message: parsed.error.issues[0].message });
      return;
    }
    if (TURNSTILE_SITE_KEY && !captchaToken) {
      setStatus({ kind: "error", message: "Please complete the check below." });
      return;
    }
    setStatus({ kind: "sending" });
    const { error } = await (
      await supabase()
    ).auth.signInWithOtp({
      email: parsed.data,
      options: {
        emailRedirectTo: callbackUrl(),
        shouldCreateUser: true,
        captchaToken: captchaToken ?? undefined,
      },
    });
    setCaptchaReset((n) => n + 1); // tokens are single-use
    setStatus(
      error
        ? { kind: "error", message: error.message }
        : { kind: "sent", email: parsed.data },
    );
  }

  async function signInWithGoogle() {
    setStatus({ kind: "sending" });
    const { error } = await (
      await supabase()
    ).auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: callbackUrl() },
    });
    if (error) setStatus({ kind: "error", message: error.message });
  }

  if (status.kind === "sent") {
    return (
      <CodeStep
        email={status.email}
        onBack={() => setStatus({ kind: "idle" })}
      />
    );
  }

  const busy = status.kind === "sending";

  return (
    <div className="flex flex-col gap-4">
      <Button
        variant="secondary"
        size="lg"
        onClick={signInWithGoogle}
        disabled={busy}
      >
        <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
          <path
            fill="#FFC107"
            d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"
          />
          <path
            fill="#FF3D00"
            d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"
          />
          <path
            fill="#4CAF50"
            d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"
          />
          <path
            fill="#1976D2"
            d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"
          />
        </svg>
        Continue with Google
      </Button>

      <div className="text-muted flex items-center gap-3 text-xs uppercase">
        <span className="h-px flex-1 bg-white/10" />
        or
        <span className="h-px flex-1 bg-white/10" />
      </div>

      <form onSubmit={sendMagicLink} className="flex flex-col gap-3" noValidate>
        <label htmlFor="email" className="text-sm font-semibold">
          Email
        </label>
        <input
          id="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="bg-surface-2 text-text min-h-12 rounded-xl border border-white/10 px-4 placeholder:text-[#6f7a99]"
          placeholder="you@example.com"
          aria-invalid={status.kind === "error" || undefined}
          aria-describedby={status.kind === "error" ? "login-error" : undefined}
        />
        <Turnstile onToken={setCaptchaToken} resetKey={captchaReset} />
        <Button type="submit" size="lg" disabled={busy}>
          {busy ? "Sending…" : "Email me a sign-in code"}
        </Button>
      </form>

      {status.kind === "error" ? (
        <p id="login-error" role="alert" className="text-danger text-sm">
          {status.message}
        </p>
      ) : null}
    </div>
  );
}

/** 6-digit code entry: works inside an installed iOS PWA, where email links open Safari. */
function CodeStep({ email, onBack }: { email: string; onBack: () => void }) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function verify(e: FormEvent) {
    e.preventDefault();
    const token = code.replace(/\D/g, "");
    if (token.length !== 6) {
      setError("Enter the 6-digit code from the email");
      return;
    }
    setBusy(true);
    setError(null);
    const { error } = await (
      await supabase()
    ).auth.verifyOtp({
      email,
      token,
      type: "email",
    });
    if (error) {
      setBusy(false);
      setError(error.message);
      return;
    }
    // proxy.ts routes new users on to /onboarding.
    router.replace(nextPath());
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      <div role="status" className="text-center">
        <p className="font-semibold">Check your inbox</p>
        <p className="text-muted mt-1 text-sm">
          We sent a code to <strong className="text-text">{email}</strong>.
          Enter it below, or tap the link in the email on this device.
        </p>
      </div>
      <form onSubmit={verify} className="flex flex-col gap-3" noValidate>
        <label htmlFor="otp" className="text-sm font-semibold">
          6-digit code
        </label>
        <input
          id="otp"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]*"
          value={code}
          // Strip spaces/dashes first so a pasted "123 456" isn't cut by maxLength.
          onChange={(e) =>
            setCode(e.target.value.replace(/\D/g, "").slice(0, 6))
          }
          className="bg-surface-2 text-text min-h-12 rounded-xl border border-white/10 px-4 text-center text-2xl tracking-[0.4em]"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "otp-error" : undefined}
        />
        <Button type="submit" size="lg" disabled={busy}>
          {busy ? "Checking…" : "Sign in"}
        </Button>
      </form>
      {error ? (
        <p id="otp-error" role="alert" className="text-danger text-sm">
          {error}
        </p>
      ) : null}
      <Button variant="ghost" onClick={onBack}>
        Use a different email
      </Button>
    </div>
  );
}
