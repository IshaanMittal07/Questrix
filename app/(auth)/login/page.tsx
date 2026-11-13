import type { Metadata } from "next";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage() {
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
      <LoginForm />
    </main>
  );
}
