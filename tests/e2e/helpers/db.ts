import { execFileSync } from "node:child_process";

/**
 * Runs SQL as postgres in the local Supabase DB container. Test-only: the
 * shop E2E needs a balance, and clients can never credit points.
 */
export function sql(query: string): string {
  return execFileSync(
    "docker",
    [
      "exec",
      "-i",
      "supabase_db_questrix",
      "psql",
      "-U",
      "postgres",
      "-tAq",
      "-v",
      "ON_ERROR_STOP=1",
    ],
    { input: query, encoding: "utf8" },
  ).trim();
}

/** Credits a user through the ledger, so balance = sum(ledger) holds. */
export function creditPoints(username: string, amount: number) {
  if (!/^[a-z0-9_]{3,20}$/.test(username) || !Number.isInteger(amount)) {
    throw new Error("bad credit input");
  }
  sql(`
    insert into public.points_ledger (user_id, delta, reason)
    select id, ${amount}, 'admin_adjust' from public.profiles where username = '${username}';
    update public.profiles set points_balance = points_balance + ${amount}
     where username = '${username}';
  `);
}
