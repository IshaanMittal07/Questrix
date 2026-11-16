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

  it("retries the script on the next mount after a load error", async () => {
    const Turnstile = await loadTurnstile("test-site-key");
    const scriptTag = () =>
      document.head.querySelector<HTMLScriptElement>(
        'script[src*="challenges.cloudflare.com"]',
      );

    const first = render(<Turnstile onToken={() => {}} resetKey={0} />);
    await act(async () => {
      scriptTag()!.dispatchEvent(new Event("error"));
    });
    expect(scriptTag()).toBeNull(); // the failed tag is gone
    first.unmount();

    render(<Turnstile onToken={() => {}} resetKey={0} />);
    const retry = scriptTag();
    expect(retry).not.toBeNull(); // a fresh tag was added
    await act(async () => {
      retry!.dispatchEvent(new Event("error"));
    });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "security check couldn't load",
    );
  });

  it("shows a widget error, then clears it when a token arrives", async () => {
    type Opts = {
      callback: (t: string) => void;
      "error-callback": () => void;
    };
    let opts: Opts | undefined;
    window.turnstile = {
      render: vi.fn((_el: HTMLElement, o: Opts) => {
        opts = o;
        return "widget-1";
      }),
      reset: vi.fn(),
      remove: vi.fn(),
    } as unknown as NonNullable<typeof window.turnstile>;

    try {
      const Turnstile = await loadTurnstile("test-site-key");
      const onToken = vi.fn();
      render(<Turnstile onToken={onToken} resetKey={0} />);
      await act(async () => {}); // let loadScript() resolve
      expect(opts).toBeDefined();

      await act(async () => opts!["error-callback"]());
      expect(screen.getByRole("alert")).toHaveTextContent(
        "security check failed",
      );
      expect(onToken).toHaveBeenLastCalledWith(null);

      await act(async () => opts!.callback("tok-123"));
      expect(screen.queryByRole("alert")).toBeNull();
      expect(onToken).toHaveBeenLastCalledWith("tok-123");
    } finally {
      delete window.turnstile;
    }
  });
});
