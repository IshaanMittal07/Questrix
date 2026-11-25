import Link from "next/link";
import { Button } from "@/components/ui/Button";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-2xl font-bold tracking-wider uppercase">Not found</h1>
      <p className="text-muted">
        That page or profile doesn&apos;t exist, or isn&apos;t available to you.
      </p>
      <Button asChild>
        <Link href="/today">Back to Today</Link>
      </Button>
    </main>
  );
}
