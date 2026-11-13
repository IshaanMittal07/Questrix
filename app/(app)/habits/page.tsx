import type { Metadata } from "next";
import { PagePlaceholder } from "@/components/ui/PagePlaceholder";

export const metadata: Metadata = { title: "Habits" };

export default function HabitsPage() {
  return <PagePlaceholder title="Habits" phase={3} />;
}
