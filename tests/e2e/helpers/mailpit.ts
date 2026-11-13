/** Reads sign-in codes from the local Supabase Mailpit inbox. */
const MAILPIT_URL = process.env.MAILPIT_URL ?? "http://127.0.0.1:55324";

type MailpitSearch = { messages: { ID: string }[] };
type MailpitMessage = { Text: string; HTML: string };

export async function waitForSignInCode(
  email: string,
  timeoutMs = 15_000,
): Promise<string> {
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
        const match = (msg.Text || msg.HTML).match(/\b(\d{6})\b/);
        if (match) return match[1];
      }
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`No sign-in email for ${email} within ${timeoutMs} ms`);
}
