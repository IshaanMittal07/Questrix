import "server-only";

export type VapidDetails = {
  subject: string;
  publicKey: string;
  privateKey: string;
};

/**
 * VAPID settings, read when a send needs them (never at import or build
 * time: CI builds without real keys). Null when anything is missing or
 * malformed, so the caller can fail with a clear, secret-free message.
 */
export function readVapid(
  env: Record<string, string | undefined> = process.env,
): VapidDetails | null {
  const subject = env.VAPID_SUBJECT?.trim();
  const publicKey = env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim();
  const privateKey = env.VAPID_PRIVATE_KEY?.trim();
  if (!subject || !publicKey || !privateKey) return null;
  // Safari rejects https://localhost subjects; a mailto: always works.
  if (
    !/^mailto:[^@\s]+@[^@\s]+$/.test(subject) &&
    !/^https:\/\//.test(subject)
  ) {
    return null;
  }
  // An uncompressed P-256 public key (65 bytes) and a 32-byte private key,
  // base64url.
  if (!/^[A-Za-z0-9_-]{87}=?$/.test(publicKey)) return null;
  if (!/^[A-Za-z0-9_-]{43}=?$/.test(privateKey)) return null;
  return { subject, publicKey, privateKey };
}
