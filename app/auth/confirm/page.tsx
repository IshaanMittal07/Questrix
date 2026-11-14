import type { Metadata } from "next";
import { Suspense } from "react";
import { confirmEmailLink } from "./actions";
import { ConfirmButton } from "./ConfirmButton";

export const metadata: Metadata = {
  title: "Confirm sign-in",
  robots: { index: false, follow: false },
};

type Search = Promise<Record<string, string | string[] | undefined>>;

function first(v: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] : v;
}

/**
 * Email link landing. It only renders a button: verifying on GET would let mail
 * scanners (Safe Links etc.) burn the one-time token before the user taps it.
 */
async function ConfirmForm({ searchParams }: { searchParams: Search }) {
  const params = await searchParams;
  const tokenHash = first(params.token_hash);
  const type = first(params.type);

  if (!tokenHash || !type) {
    return (
      <p role="alert" className="text-danger text-sm">
        This sign-in link is incomplete. Request a new code from the sign-in
        page.
      </p>
    );
  }

  return (
    <form action={confirmEmailLink} className="flex flex-col gap-3">
      <input type="hidden" name="token_hash" value={tokenHash} />
      <input type="hidden" name="type" value={type} />
      <ConfirmButton />
    </form>
  );
}

export default function ConfirmPage({
  searchParams,
}: {
  searchParams: Search;
}) {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 px-4 py-[max(2rem,env(safe-area-inset-top))] text-center">
      <div className="flex flex-col items-center gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element -- static brand SVG */}
        <img src="/brand/icon.svg" alt="" width={64} height={64} />
        <h1 className="text-2xl font-bold">Almost there</h1>
        <p className="text-muted">Tap the button to finish signing in.</p>
      </div>
      <Suspense fallback={null}>
        <ConfirmForm searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
