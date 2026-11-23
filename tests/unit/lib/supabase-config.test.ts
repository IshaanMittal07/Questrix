import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * pg_net keeps queued request headers (the cron's bearer secret) in
 * net.http_request_queue, which every role can read; Vault and pg_cron hold
 * secrets and jobs. They're safe only while the API can't reach them
 * (DECISIONS P9, review of PR #98).
 */
describe("supabase/config.toml", () => {
  const toml = readFileSync("supabase/config.toml", "utf8");
  const api = toml.slice(toml.indexOf("[api]"));
  const line = api.match(/^schemas\s*=\s*\[([^\]]*)\]/m);

  it("lists the exposed API schemas", () => {
    expect(line).not.toBeNull();
  });

  it("never exposes net, vault or cron", () => {
    const schemas = (line?.[1] ?? "")
      .split(",")
      .map((s) => s.trim().replace(/^"|"$/g, ""));
    for (const forbidden of [
      "net",
      "vault",
      "cron",
      "pgsodium",
      "extensions",
    ]) {
      expect(schemas).not.toContain(forbidden);
    }
  });
});
