import { NextResponse, type NextRequest } from "next/server";
import { isSameOriginRequest } from "@/lib/http/same-origin";
import { createClient } from "@/lib/supabase/server";

/**
 * Settings → Export my data (plan §9): the caller's own data as a JSON file.
 * export_my_data() reads only auth.uid()'s rows. Same-origin only, like every
 * API route: the Settings link sends Sec-Fetch-Site: same-origin.
 */
export async function GET(request: NextRequest) {
  if (!isSameOriginRequest(request.headers, request.url)) {
    return new NextResponse("Forbidden", { status: 403 });
  }
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) {
    return new NextResponse("Unauthorized", { status: 401 });
  }
  const { data, error } = await supabase.rpc("export_my_data");
  if (error || !data) {
    return new NextResponse("Couldn't export. Try again.", { status: 500 });
  }
  const date = new Date().toISOString().slice(0, 10);
  return new NextResponse(JSON.stringify(data, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="questrix-export-${date}.json"`,
      "cache-control": "no-store",
    },
  });
}
