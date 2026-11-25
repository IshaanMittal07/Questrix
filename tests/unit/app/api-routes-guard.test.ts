import { readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every app/api route outside app/api/cron (which has its own bearer guard
 * test) acts for a signed-in user from our own pages. Each exported handler
 * must refuse other origins (isSameOriginRequest) and check the session
 * (getClaims or getVerifiedUser), either directly or through a helper
 * defined in the same file. This fails when a new route forgets either.
 */
const ROOT = join(__dirname, "..", "..", "..");
const API = join(ROOT, "app", "api");

const routes = readdirSync(API, { recursive: true, encoding: "utf8" })
  .filter((f) => /(^|[\\/])route\.(ts|tsx|js|mjs)$/.test(f))
  .map((f) => relative(ROOT, join(API, f)).split(sep).join("/"))
  .filter((f) => !f.startsWith("app/api/cron/"))
  .sort();

const METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"];
const ORIGIN_CHECK = /\bisSameOriginRequest\s*\(/;
const SESSION_CHECK = /\b(getClaims|getVerifiedUser)\s*\(/;

/** The body of a top-level `function name` or `const name =`, to its closing brace at column 0. */
function bodyOf(src: string, name: string): string | null {
  const start = src.search(
    new RegExp(
      `^(export\\s+)?(async\\s+)?function\\s+${name}\\b|^(export\\s+)?const\\s+${name}\\b`,
      "m",
    ),
  );
  if (start === -1) return null;
  const rest = src.slice(start);
  const end = rest.search(/\n\}/);
  return end === -1 ? rest : rest.slice(0, end + 2);
}

/** Top-level function (or const) names declared in the file. */
function localNames(src: string): string[] {
  const names = new Set<string>();
  for (const m of src.matchAll(
    /^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)|^(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=/gm,
  )) {
    names.add(m[1] ?? m[2]);
  }
  return [...names];
}

/**
 * Does `name` reach `check`, directly or through local helpers it calls?
 * Calls to imported functions don't count, except the check itself.
 */
function reaches(
  src: string,
  name: string,
  check: RegExp,
  seen = new Set<string>(),
): boolean {
  if (seen.has(name)) return false;
  seen.add(name);
  const body = bodyOf(src, name);
  if (!body) return false;
  if (check.test(body)) return true;
  return localNames(src)
    .filter((n) => n !== name && new RegExp(`\\b${n}\\s*\\(`).test(body))
    .some((n) => reaches(src, n, check, seen));
}

function handlers(src: string) {
  return METHODS.filter((m) =>
    new RegExp(
      `export\\s+(async\\s+)?function\\s+${m}\\b|export\\s+const\\s+${m}\\b`,
    ).test(src),
  );
}

/** Problems with a route's source: an empty list means it's guarded. */
function problems(src: string): string[] {
  const out: string[] = [];
  const hs = handlers(src);
  if (hs.length === 0) out.push("no exported handler found");
  for (const m of hs) {
    if (!reaches(src, m, ORIGIN_CHECK))
      out.push(`${m}: no isSameOriginRequest`);
    if (!reaches(src, m, SESSION_CHECK)) {
      out.push(`${m}: no getClaims/getVerifiedUser`);
    }
  }
  // A re-exported handler would dodge the body check.
  if (
    /export\s*\{[^}]*\b(GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS)\b/.test(src)
  ) {
    out.push("re-exports a handler");
  }
  if (/export\s*\*\s*from/.test(src)) out.push("export * from");
  return out;
}

describe("api route guard", () => {
  it("finds the non-cron api routes", () => {
    expect(routes).toContain("app/api/push/subscribe/route.ts");
    expect(routes.some((f) => f.startsWith("app/api/cron/"))).toBe(false);
  });

  it.each(routes)(
    "%s checks the origin and the session in every handler",
    (f) => {
      expect(problems(readFileSync(join(ROOT, f), "utf8"))).toEqual([]);
    },
  );

  describe("the checker itself", () => {
    it("accepts direct checks", () => {
      const src = `export async function POST(r: Request) {
  if (!isSameOriginRequest(r.headers, r.url)) return x;
  const { data } = await s.auth.getClaims();
}
`;
      expect(problems(src)).toEqual([]);
    });

    it("accepts checks through local helpers, two levels deep", () => {
      const src = `async function session() {
  return s.auth.getClaims();
}
async function guard(r: Request) {
  if (!isSameOriginRequest(r.headers, r.url)) return x;
  return session();
}
export async function DELETE(r: Request) {
  const g = await guard(r);
}
`;
      expect(problems(src)).toEqual([]);
    });

    it("accepts getVerifiedUser", () => {
      const src = `export const GET = async (r: Request) => {
  isSameOriginRequest(r.headers, r.url);
  await getVerifiedUser();
};
`;
      expect(problems(src)).toEqual([]);
    });

    it("flags a handler missing the origin check", () => {
      const src = `export async function POST() {
  await s.auth.getClaims();
}
`;
      expect(problems(src)).toEqual(["POST: no isSameOriginRequest"]);
    });

    it("flags a handler missing the session check", () => {
      const src = `export async function PUT(r: Request) {
  isSameOriginRequest(r.headers, r.url);
}
`;
      expect(problems(src)).toEqual(["PUT: no getClaims/getVerifiedUser"]);
    });

    it("flags one unguarded handler next to a guarded one", () => {
      const src = `async function guard(r: Request) {
  isSameOriginRequest(r.headers, r.url);
  await s.auth.getClaims();
}
export async function POST(r: Request) {
  await guard(r);
}
export async function DELETE(r: Request) {
  return Response.json({});
}
`;
      expect(problems(src)).toEqual([
        "DELETE: no isSameOriginRequest",
        "DELETE: no getClaims/getVerifiedUser",
      ]);
    });

    it("doesn't count a helper that is defined but never called", () => {
      const src = `async function guard(r: Request) {
  isSameOriginRequest(r.headers, r.url);
  await s.auth.getClaims();
}
export async function POST(r: Request) {
  return Response.json({});
}
`;
      expect(problems(src)).toHaveLength(2);
    });

    it("flags re-exported handlers", () => {
      expect(problems(`export { POST } from "./other";\n`)).toContain(
        "re-exports a handler",
      );
      expect(problems(`export * from "./other";\n`)).toContain("export * from");
    });
  });
});
