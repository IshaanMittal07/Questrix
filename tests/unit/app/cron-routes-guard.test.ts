import { readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every route under app/api/cron/ skips the session proxy (proxy.ts), so it
 * must check the cron secret itself. This fails when a new cron route forgets.
 */
const ROOT = join(__dirname, "..", "..", "..");
const CRON = join(ROOT, "app", "api", "cron");

const routes = readdirSync(CRON, { recursive: true, encoding: "utf8" })
  .filter((f) => /(^|[\\/])route\.(ts|tsx|js|mjs)$/.test(f))
  .map((f) => relative(ROOT, join(CRON, f)).split(sep).join("/"))
  .sort();

const METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"];

describe("cron route guard", () => {
  it("finds the cron routes", () => {
    expect(routes).toContain("app/api/cron/reminders/route.ts");
  });

  it.each(routes)(
    "%s imports hasBearer and checks it in every handler",
    (f) => {
      const src = readFileSync(join(ROOT, f), "utf8");
      expect(src).toMatch(
        /import\s*\{[^}]*\bhasBearer\b[^}]*\}\s*from\s*["']@\/lib\/http\/bearer["']/,
      );
      const handlers = METHODS.filter((m) =>
        new RegExp(
          `export\\s+(async\\s+)?function\\s+${m}\\b|export\\s+const\\s+${m}\\b`,
        ).test(src),
      );
      expect(handlers.length).toBeGreaterThan(0);
      // Each handler's body (up to the next export) calls hasBearer.
      for (const m of handlers) {
        const start = src.search(
          new RegExp(`export\\s+(async\\s+)?(function|const)\\s+${m}\\b`),
        );
        const rest = src.slice(start);
        const next = rest.slice(1).search(/\nexport\s/);
        const body = next === -1 ? rest : rest.slice(0, next + 1);
        expect(body, `${m} in ${f}`).toMatch(/\bhasBearer\s*\(/);
      }
      // No re-export of a handler from elsewhere, which would dodge this check.
      expect(src).not.toMatch(
        /export\s*\{[^}]*\b(GET|POST|PUT|PATCH|DELETE)\b/,
      );
      expect(src).not.toMatch(/export\s*\*\s*from/);
    },
  );
});
