import "server-only";

import { createECDH } from "node:crypto";
import { getVapidHeaders } from "web-push";

export type VapidDetails = {
  subject: string;
  publicKey: string;
  privateKey: string;
};

/**
 * VAPID settings, read when a send needs them (never at import or build
 * time: CI builds without real keys). Null when anything is missing or
 * unusable, so the caller can fail with a clear, secret-free message.
 *
 * web-push itself is the validator: it signs a throwaway header with the
 * keys. A format check of our own drifted from it (a padded key passed ours
 * and failed every send; review of PR #97).
 */
export function readVapid(
  env: Record<string, string | undefined> = process.env,
): VapidDetails | null {
  const subject = env.VAPID_SUBJECT?.trim();
  const publicKey = env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim();
  const privateKey = env.VAPID_PRIVATE_KEY?.trim();
  if (!subject || !publicKey || !privateKey) return null;
  // Safari rejects local subjects; a mailto: always works.
  if (isLocalSubject(subject)) return null;
  try {
    getVapidHeaders(
      "https://fcm.googleapis.com",
      subject,
      publicKey,
      privateKey,
      "aes128gcm",
    );
    // The public key must be the private key's: a mismatched pair signs
    // fine and then gets 403 from every push service.
    const ecdh = createECDH("prime256v1");
    ecdh.setPrivateKey(Buffer.from(privateKey, "base64url"));
    if (ecdh.getPublicKey().toString("base64url") !== publicKey) return null;
  } catch {
    return null;
  }
  return { subject, publicKey, privateKey };
}

function isLocalSubject(subject: string) {
  if (!/^https:/i.test(subject)) return false;
  try {
    const host = new URL(subject).hostname.replace(/\.$/, "").toLowerCase();
    return (
      host === "localhost" ||
      host.endsWith(".localhost") ||
      host === "[::1]" ||
      /^127\./.test(host)
    );
  } catch {
    return true;
  }
}
