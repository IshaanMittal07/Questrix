import type { Metadata } from "next";
import { PagePlaceholder } from "@/components/ui/PagePlaceholder";

export const metadata: Metadata = { title: "Feed" };

export default function FeedPage() {
  return <PagePlaceholder title="Feed" phase={7} />;
}
