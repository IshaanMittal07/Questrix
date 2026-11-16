import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

async function loadTurnstile(siteKey: string | undefined) {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", siteKey ?? "");
  return (await import("@/components/auth/Turnstile")).Turnstile;
}

afterEach(() => {
  vi.unstubAllEnvs();
  document.head
    .querySelectorAll('script[src*="challenges.cloudflare.com"]')
    .forEach((s) => s.remove());
});

describe("Turnstile", () => {
  it("renders nothing without a site key", async () => {
    const Turnstile = await loadTurnstile(undefined);
    const { container } = render(<Turnstile onToken={() => {}} resetKey={0} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("explains when the script can't load", async () => {
    const Turnstile = await loadTurnstile("test-site-key");
    const onToken = vi.fn();
    render(<Turnstile onToken={onToken} resetKey={0} />);

    const script = document.head.querySelector<HTMLScriptElement>(
      'script[src*="challenges.cloudflare.com"]',
    );
    expect(script).not.toBeNull();
    await act(async () => {
      script!.dispatchEvent(new Event("error"));
    });

    expect(screen.getByRole("alert")).toHaveTextContent(
      "security check couldn't load",
    );
    expect(onToken).toHaveBeenCalledWith(null);
  });
});
