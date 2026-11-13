import type { Metadata } from "next";
import { PagePlaceholder } from "@/components/ui/PagePlaceholder";

export const metadata: Metadata = { title: "Shop" };

export default function ShopPage() {
  return <PagePlaceholder title="Shop" phase={6} />;
}
