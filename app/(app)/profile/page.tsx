import type { Metadata } from "next";
import { PagePlaceholder } from "@/components/ui/PagePlaceholder";

export const metadata: Metadata = { title: "Profile" };

export default function ProfilePage() {
  return <PagePlaceholder title="Profile" phase={6} />;
}
