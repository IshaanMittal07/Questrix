import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { hasBearer } from "@/lib/http/bearer";
import { readVapid } from "@/lib/push/vapid";

const PUB = "B" + "a".repeat(86);
const PRIV = "k".repeat(43);

describe("readVapid", () => {
  it("returns the keys when all three are valid", () => {
    expect(
      readVapid({
        VAPID_SUBJECT: "mailto:ops@example.com",
        NEXT_PUBLIC_VAPID_PUBLIC_KEY: PUB,
        VAPID_PRIVATE_KEY: PRIV,
      }),
    ).toEqual({
      subject: "mailto:ops@example.com",
      publicKey: PUB,
      privateKey: PRIV,
    });
  });

  it.each([
    [{}],
    [{ VAPID_SUBJECT: "mailto:a@b.c", NEXT_PUBLIC_VAPID_PUBLIC_KEY: PUB }],
    [
      {
        VAPID_SUBJECT: "ops",
        NEXT_PUBLIC_VAPID_PUBLIC_KEY: PUB,
        VAPID_PRIVATE_KEY: PRIV,
      },
    ],
    [
      {
        VAPID_SUBJECT: "mailto:a@b.c",
        NEXT_PUBLIC_VAPID_PUBLIC_KEY: "dummy-vapid-key",
        VAPID_PRIVATE_KEY: PRIV,
      },
    ],
    [
      {
        VAPID_SUBJECT: "mailto:a@b.c",
        NEXT_PUBLIC_VAPID_PUBLIC_KEY: PUB,
        VAPID_PRIVATE_KEY: "short",
      },
    ],
  ])("is null when keys are missing or malformed (%#)", (env) => {
    expect(readVapid(env)).toBeNull();
  });
});

describe("hasBearer", () => {
  const h = (v?: string) => new Headers(v ? { authorization: v } : {});

  it("accepts the exact secret", () => {
    expect(hasBearer(h("Bearer s3cret"), "s3cret")).toBe(true);
  });

  it.each([
    undefined,
    "Bearer wrong",
    "Bearer s3cre",
    "s3cret",
    "bearer s3cret",
  ])("refuses %s", (v) => {
    expect(hasBearer(h(v), "s3cret")).toBe(false);
  });

  it("never matches when the secret isn't configured", () => {
    expect(hasBearer(h("Bearer "), "")).toBe(false);
    expect(hasBearer(h("Bearer undefined"), undefined)).toBe(false);
  });
});
