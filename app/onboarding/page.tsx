import type { Metadata } from "next";
import { Suspense } from "react";
import { assetSvg } from "@/components/avatar/Avatar";
import { createClient } from "@/lib/supabase/server";
import { OnboardingForm } from "./OnboardingForm";

export const metadata: Metadata = { title: "Welcome" };

async function OnboardingData() {
  const supabase = await createClient();
  const { data: bases } = await supabase
    .from("items")
    .select("id, name, asset")
    .eq("category", "avatar_base")
    .eq("is_default", true)
    .order("slug");
  const options = (bases ?? []).map((b) => ({
    id: b.id,
    name: b.name,
    svg: assetSvg(b.asset),
  }));
  return <OnboardingForm avatarBases={options} />;
}

export default function OnboardingPage() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 px-4 py-[max(2rem,env(safe-area-inset-top))]">
      <div>
        <p className="text-cyan text-sm font-semibold tracking-widest uppercase">
          Welcome
        </p>
        <h1 className="mt-1 text-2xl font-bold">Create your hero</h1>
        <p className="text-muted mt-1">
          Pick a name and a look. You can unlock more later.
        </p>
      </div>
      <Suspense fallback={<p className="text-muted">Loading…</p>}>
        <OnboardingData />
      </Suspense>
    </main>
  );
}
