import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { generateVAPIDKeys } from "web-push";
import { MIN_SECRET_LENGTH, hasBearer } from "@/lib/http/bearer";
import { readVapid } from "@/lib/push/vapid";

const { publicKey: PUB, privateKey: PRIV } = generateVAPIDKeys();
const SUBJECT = "mailto:ops@example.com";
const env = (over: Record<string, string | undefined> = {}) => ({
  VAPID_SUBJECT: SUBJECT,
  NEXT_PUBLIC_VAPID_PUBLIC_KEY: PUB,
  VAPID_PRIVATE_KEY: PRIV,
  ...over,
});

describe("readVapid", () => {
  it("accepts a real generated pair", () => {
    expect(readVapid(env())).toEqual({
      subject: SUBJECT,
      publicKey: PUB,
      privateKey: PRIV,
    });
  });

  it("accepts an https:// subject", () => {
    expect(readVapid(env({ VAPID_SUBJECT: "https://questrix.app" }))).toEqual(
      expect.objectContaining({ subject: "https://questrix.app" }),
    );
  });

  it("trims surrounding whitespace (a pasted env value)", () => {
    expect(
      readVapid(
        env({
          VAPID_SUBJECT: ` ${SUBJECT}
`,
          NEXT_PUBLIC_VAPID_PUBLIC_KEY: ` ${PUB} `,
          VAPID_PRIVATE_KEY: `${PRIV}
`,
        }),
      ),
    ).toEqual({ subject: SUBJECT, publicKey: PUB, privateKey: PRIV });
  });

  it.each([
    ["nothing set", {}],
    [
      "no private key",
      { VAPID_SUBJECT: SUBJECT, NEXT_PUBLIC_VAPID_PUBLIC_KEY: PUB },
    ],
    ["an empty subject", env({ VAPID_SUBJECT: "  " })],
    ["a bare subject", env({ VAPID_SUBJECT: "ops" })],
    ["an http:// subject", env({ VAPID_SUBJECT: "http://questrix.app" })],
    ["https://localhost", env({ VAPID_SUBJECT: "https://localhost" })],
    [
      "https://localhost with a port",
      env({ VAPID_SUBJECT: "https://localhost:3000" }),
    ],
    [
      "https://LOCALHOST/ with a path",
      env({ VAPID_SUBJECT: "https://LOCALHOST/x" }),
    ],
    [
      "a dummy public key",
      env({ NEXT_PUBLIC_VAPID_PUBLIC_KEY: "dummy-vapid-key" }),
    ],
    ["a short private key", env({ VAPID_PRIVATE_KEY: "short" })],
    ["a padded private key", env({ VAPID_PRIVATE_KEY: `${PRIV}=` })],
    [
      "a public key with a standard-base64 character",
      env({
        NEXT_PUBLIC_VAPID_PUBLIC_KEY: `B+${PUB.slice(2)}`,
      }),
    ],
    [
      "the keys swapped",
      env({ NEXT_PUBLIC_VAPID_PUBLIC_KEY: PRIV, VAPID_PRIVATE_KEY: PUB }),
    ],
  ])("is null for %s", (_label, e) => {
    expect(readVapid(e)).toBeNull();
  });

  it("refuses a mismatched pair and a 65-byte non-key", () => {
    // The public key is derived from the private one and compared.
    const other = generateVAPIDKeys();
    expect(
      readVapid(env({ NEXT_PUBLIC_VAPID_PUBLIC_KEY: other.publicKey })),
    ).toBeNull();
    expect(
      readVapid(env({ NEXT_PUBLIC_VAPID_PUBLIC_KEY: "B" + "a".repeat(86) })),
    ).toBeNull();
  });

  it.each([
    "https://127.0.0.1",
    "https://[::1]/x",
    "https://localhost./x",
    "https://app.localhost",
  ])("refuses the local subject %s", (subject) => {
    expect(readVapid(env({ VAPID_SUBJECT: subject }))).toBeNull();
  });

  it("refuses a padded public key from a real pair, because web-push would refuse every send", async () => {
    // The byte comparison would match, but getVapidHeaders (and so
    // sendNotification) rejects "=" first. Accepting it here would turn a
    // clear 500 into every push failing.
    const webPush = await import("web-push");
    expect(() =>
      webPush.getVapidHeaders(
        "https://fcm.googleapis.com",
        SUBJECT,
        `${PUB}=`,
        PRIV,
        "aes128gcm",
      ),
    ).toThrow(/without "="/);
    expect(
      readVapid(env({ NEXT_PUBLIC_VAPID_PUBLIC_KEY: `${PUB}=` })),
    ).toBeNull();
  });

  it("accepts a subject whose host merely starts with localhost", () => {
    expect(
      readVapid(env({ VAPID_SUBJECT: "https://localhost.questrix.app" })),
    ).not.toBeNull();
  });

  it("never throws and never logs a key", () => {
    const spies = (["log", "info", "warn", "error"] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => {}),
    );
    for (const e of [
      env({ VAPID_PRIVATE_KEY: `${PRIV}=` }),
      env({ NEXT_PUBLIC_VAPID_PUBLIC_KEY: "x" }),
      env({ VAPID_SUBJECT: "https://localhost" }),
      env(),
    ]) {
      expect(() => readVapid(e)).not.toThrow();
    }
    const out = JSON.stringify(spies.map((s) => s.mock.calls));
    expect(out).not.toContain(PRIV);
    expect(out).not.toContain(PUB);
    for (const s of spies) s.mockRestore();
  });
});

describe("hasBearer", () => {
  const h = (v?: string) => new Headers(v ? { authorization: v } : {});

  it("accepts the exact secret", () => {
    expect(
      hasBearer(
        h("Bearer s3cret-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"),
        "s3cret-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
      ),
    ).toBe(true);
  });

  it.each([
    undefined,
    "Bearer wrong",
    "Bearer s3cre",
    "s3cret-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    "bearer s3cret",
  ])("refuses %s", (v) => {
    expect(hasBearer(h(v), "s3cret-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx")).toBe(
      false,
    );
  });

  it(`never matches a secret shorter than ${MIN_SECRET_LENGTH}, even when sent exactly`, () => {
    const short = "s".repeat(MIN_SECRET_LENGTH - 1);
    expect(hasBearer(h(`Bearer ${short}`), short)).toBe(false);
    const exact = "s".repeat(MIN_SECRET_LENGTH);
    expect(hasBearer(h(`Bearer ${exact}`), exact)).toBe(true);
  });

  it("never matches when the secret isn't configured", () => {
    expect(hasBearer(h("Bearer "), "")).toBe(false);
    expect(hasBearer(h("Bearer undefined"), undefined)).toBe(false);
  });
});
