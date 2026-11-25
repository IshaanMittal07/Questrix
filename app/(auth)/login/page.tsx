import type { Metadata } from "next";
import { Suspense } from "react";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = { title: "Sign in" };

const ERRORS: Record<string, string> = {
  auth: "Google sign-in didn't finish. Please try again.",
  link: "That sign-in link has expired or was already used. Request a new code.",
};

type Search = Promise<Record<string, string | string[] | undefined>>;

async function LoginError({ searchParams }: { searchParams: Search }) {
  const raw = (await searchParams).error;
  const key = Array.isArray(raw) ? (raw[0] ?? "") : (raw ?? "");
  // Own keys only: "__proto__" or "constructor" must not resolve to built-ins.
  const message = Object.hasOwn(ERRORS, key) ? ERRORS[key] : undefined;
  if ((await searchParams).deleted === "1") {
    return (
      <p
        role="status"
        className="text-muted rounded-xl border border-current/30 px-4 py-3 text-center text-sm"
      >
        Your account and its data were deleted.
      </p>
    );
  }
  if (!message) return null;
  return (
    <p
      role="alert"
      className="text-danger rounded-xl border border-current/30 px-4 py-3 text-center text-sm"
    >
      {message}
    </p>
  );
}

export default function LoginPage({ searchParams }: { searchParams: Search }) {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-8 px-4 py-[max(2rem,env(safe-area-inset-top))]">
      <div className="flex flex-col items-center gap-3 text-center">
        {/* eslint-disable-next-line @next/next/no-img-element -- static brand SVG */}
        <img src="/brand/icon.svg" alt="" width={72} height={72} />
        <h1 className="text-2xl font-bold tracking-[0.3em] uppercase">
          Questrix
        </h1>
        <p className="text-muted">Level up your real life.</p>
      </div>
      <Suspense fallback={null}>
        <LoginError searchParams={searchParams} />
      </Suspense>
      <LoginForm />
    </main>
  );
}
