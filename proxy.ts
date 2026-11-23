import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    // Everything except static assets, the service worker, manifest, icons and
    // the cron (pg_net has no session: the route checks its own secret).
    "/((?!api/cron/|_next/static|_next/image|favicon.ico|icon.svg|sw.js|offline.html|manifest.webmanifest|icons/|brand/|cosmetics/|.*\.(?:png|jpg|jpeg|svg|webp|ico)$).*)",
  ],
};
