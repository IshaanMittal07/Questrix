/** Reads sign-in emails from the local Supabase Mailpit inbox. */
const MAILPIT_URL = process.env.MAILPIT_URL ?? "http://127.0.0.1:55324";

type MailpitSearch = { messages: { ID: string }[] };
type MailpitMessage = { Text: string; HTML: string };

async function waitForEmail<T>(
  email: string,
  extract: (msg: MailpitMessage) => T | null,
  timeoutMs: number,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await fetch(
      `${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`,
    );
    if (res.ok) {
      const { messages } = (await res.json()) as MailpitSearch;
      if (messages.length > 0) {
        const msg = (await (
          await fetch(`${MAILPIT_URL}/api/v1/message/${messages[0].ID}`)
        ).json()) as MailpitMessage;
        const value = extract(msg);
        if (value !== null) return value;
      }
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`No sign-in email for ${email} within ${timeoutMs} ms`);
}

export function waitForSignInCode(email: string, timeoutMs = 15_000) {
  return waitForEmail(
    email,
    (msg) => (msg.Text || msg.HTML).match(/\b(\d{6})\b/)?.[1] ?? null,
    timeoutMs,
  );
}

/** The email's `/auth/confirm?...` link as a path (the host is the Site URL). */
export function waitForSignInLink(email: string, timeoutMs = 15_000) {
  return waitForEmail(
    email,
    (msg) => {
      const href = msg.HTML.match(/href="[^"]*?(\/auth\/confirm\?[^"]+)"/)?.[1];
      return href ? href.replaceAll("&amp;", "&") : null;
    },
    timeoutMs,
  );
}
