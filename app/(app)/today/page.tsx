import type { Metadata } from "next";
import { Card } from "@/components/ui/Card";
import { PagePlaceholder } from "@/components/ui/PagePlaceholder";
import { ProgressRing } from "@/components/ui/ProgressRing";

export const metadata: Metadata = { title: "Today" };

export default function TodayPage() {
  return (
    <PagePlaceholder title="Today" phase={4}>
      <Card className="flex items-center gap-4">
        <ProgressRing value={0} max={50} label="Level 1 progress">
          1
        </ProgressRing>
        <div>
          <p className="font-semibold">Level 1</p>
          <p className="text-muted text-sm">Your quests will appear here.</p>
        </div>
      </Card>
    </PagePlaceholder>
  );
}
