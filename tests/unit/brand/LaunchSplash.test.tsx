import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  LaunchSplash,
  SPLASH_FALLBACK_GRACE_MS,
  SPLASH_HEAD_SCRIPT,
  SPLASH_KEY,
  SPLASH_REDUCED_MS,
  SPLASH_TOTAL_MS,
  scrambleFrame,
} from "@/components/brand/LaunchSplash";

function mockReducedMotion(reduce: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: reduce && query.includes("prefers-reduced-motion: reduce"),
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

/** jsdom doesn't run CSS animations, so dispatch their events by hand. */
function animationEvent(
  el: Element,
  type: "animationstart" | "animationend",
  animationName: string,
) {
  const fire =
    type === "animationstart"
      ? fireEvent.animationStart
      : fireEvent.animationEnd;
  fire(el, { animationName });
}

const overlay = () => screen.queryByTestId("launch-splash");

beforeEach(() => {
  vi.useFakeTimers();
  sessionStorage.clear();
  delete document.documentElement.dataset.splash;
  mockReducedMotion(false);
  // Hydration right at navigation start unless a test says otherwise.
  vi.spyOn(performance, "now").mockReturnValue(0);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("LaunchSplash", () => {
  it("renders the overlay with a hidden decorative layer and a live region", () => {
    render(<LaunchSplash />);
    expect(overlay()).toBeInTheDocument();
    expect(screen.getByTestId("launch-splash-art")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Loading Questrix");
    expect(status).toHaveAttribute("aria-live", "polite");
  });

  it("marks the session as seen so it plays only once", () => {
    render(<LaunchSplash />);
    expect(sessionStorage.getItem(SPLASH_KEY)).toBe("1");
  });

  it("closes when the CSS fade-out (qx-out) finishes", () => {
    render(<LaunchSplash />);
    const el = overlay()!;
    // Animations of children bubble up but must not close it.
    animationEvent(
      screen.getByTestId("splash-wordmark"),
      "animationend",
      "qx-out",
    );
    expect(overlay()).toBeInTheDocument();
    animationEvent(el, "animationend", "qx-fade-in");
    expect(overlay()).toBeInTheDocument();
    animationEvent(el, "animationend", "qx-out");
    expect(overlay()).not.toBeInTheDocument();
    expect(document.documentElement.dataset.splash).toBe("seen");
  });

  it("has a fallback timer in case animation events never arrive", () => {
    render(<LaunchSplash />);
    act(() => vi.advanceTimersByTime(SPLASH_TOTAL_MS)); // a late paint is still mid-fade
    expect(overlay()).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(SPLASH_FALLBACK_GRACE_MS));
    expect(overlay()).not.toBeInTheDocument();
  });

  it("measures the fallback from navigation start, not from late hydration", () => {
    vi.mocked(performance.now).mockReturnValue(5000);
    render(<LaunchSplash />);
    act(() => vi.advanceTimersByTime(SPLASH_FALLBACK_GRACE_MS));
    expect(overlay()).not.toBeInTheDocument();
  });

  it("is skipped by a tap (click, so the tap can't fall through)", () => {
    render(<LaunchSplash />);
    fireEvent.click(overlay()!);
    expect(overlay()).not.toBeInTheDocument();
  });

  it("is skipped by a key press", () => {
    render(<LaunchSplash />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(overlay()).not.toBeInTheDocument();
  });

  it("leaves no listeners or timers running after it closes", () => {
    const removeSpy = vi.spyOn(window, "removeEventListener");
    const clearSpy = vi.spyOn(globalThis, "clearTimeout");
    render(<LaunchSplash />);
    fireEvent.click(overlay()!);
    expect(removeSpy).toHaveBeenCalledWith("keydown", expect.any(Function));
    expect(clearSpy).toHaveBeenCalled();
    // A later key press must not touch the (now hidden) splash.
    delete document.documentElement.dataset.splash;
    fireEvent.keyDown(window, { key: "a" });
    expect(document.documentElement.dataset.splash).toBeUndefined();
  });

  it("renders nothing when already seen this session", () => {
    document.documentElement.dataset.splash = "seen";
    render(<LaunchSplash />);
    expect(overlay()).not.toBeInTheDocument();
  });

  it("scrambles when the wordmark is revealed, then locks in QUESTRIX", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.99); // always "&"
    render(<LaunchSplash />);
    const word = screen.getByTestId("splash-wordmark");
    expect(word.textContent).toBe("QUESTRIX"); // server/initial HTML
    animationEvent(word, "animationstart", "qx-in");
    expect(word.textContent).toBe("&&&&&&&&");
    act(() => vi.advanceTimersByTime(320)); // first 40 ms tick at/after 300 ms
    expect(word.textContent).toBe("Q&&&&&&&");
    act(() => vi.advanceTimersByTime(400));
    expect(word.textContent).toBe("QUESTRIX");
  });

  it("does not scramble if hydration missed the reveal", () => {
    render(<LaunchSplash />);
    act(() => vi.advanceTimersByTime(2000));
    expect(screen.getByTestId("splash-wordmark").textContent).toBe("QUESTRIX");
  });

  describe("reduced motion", () => {
    beforeEach(() => mockReducedMotion(true));

    it("never scrambles the wordmark", () => {
      vi.spyOn(Math, "random").mockReturnValue(0.99);
      render(<LaunchSplash />);
      const word = screen.getByTestId("splash-wordmark");
      animationEvent(word, "animationstart", "qx-in");
      act(() => vi.advanceTimersByTime(500));
      expect(word.textContent).toBe("QUESTRIX");
    });

    it("uses the short 600 ms + fade fallback instead of 2.4 s", () => {
      render(<LaunchSplash />);
      act(() =>
        vi.advanceTimersByTime(SPLASH_REDUCED_MS + SPLASH_FALLBACK_GRACE_MS),
      );
      expect(overlay()).not.toBeInTheDocument();
      expect(SPLASH_REDUCED_MS + SPLASH_FALLBACK_GRACE_MS).toBeLessThan(
        SPLASH_TOTAL_MS,
      );
    });
  });
});

describe("scrambleFrame", () => {
  it("locks letters left-to-right, 50 ms apart", () => {
    const rand = () => 0.99; // "&"
    expect(scrambleFrame(0, rand)).toBe("&&&&&&&&");
    expect(scrambleFrame(300, rand)).toBe("Q&&&&&&&");
    expect(scrambleFrame(350, rand)).toBe("QU&&&&&&");
    expect(scrambleFrame(650, rand)).toBe("QUESTRIX");
  });
});

describe("SPLASH_HEAD_SCRIPT", () => {
  it("flags <html> before paint only when the session has seen the splash", () => {
    new Function(SPLASH_HEAD_SCRIPT)();
    expect(document.documentElement.dataset.splash).toBeUndefined();

    sessionStorage.setItem(SPLASH_KEY, "1");
    new Function(SPLASH_HEAD_SCRIPT)();
    expect(document.documentElement.dataset.splash).toBe("seen");
  });
});
