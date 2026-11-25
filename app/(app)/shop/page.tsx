import type { Metadata } from "next";
import { Suspense } from "react";
import { ShopView } from "@/components/shop/ShopView";
import { Card } from "@/components/ui/Card";
import { loadShop } from "@/lib/shop/queries";

export const metadata: Metadata = { title: "Shop" };

async function ShopContent() {
  const data = await loadShop();
  if (!data) {
    return (
      <Card role="alert">
        <p className="text-danger">
          Couldn&apos;t load the shop. Reload the page, or try again shortly.
        </p>
      </Card>
    );
  }
  return <ShopView data={data} />;
}

export default function ShopPage() {
  return (
    <Suspense fallback={<Card className="h-96 animate-pulse" />}>
      <ShopContent />
    </Suspense>
  );
}
