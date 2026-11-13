import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  LaunchSplash,
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
    expect(screen.getByTestId("launch-splash")).toBeInTheDocument();
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

  it("removes itself after the full 2.4 s animation", () => {
    render(<LaunchSplash />);
    act(() => vi.advanceTimersByTime(SPLASH_TOTAL_MS - 1));
    expect(screen.getByTestId("launch-splash")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByTestId("launch-splash")).not.toBeInTheDocument();
    expect(document.documentElement.dataset.splash).toBe("seen");
  });

  it("is skipped by a tap", () => {
    render(<LaunchSplash />);
    fireEvent.click(screen.getByTestId("launch-splash"));
    expect(screen.queryByTestId("launch-splash")).not.toBeInTheDocument();
  });

  it("leaves no listeners or timers running after it closes", () => {
    const removeSpy = vi.spyOn(window, "removeEventListener");
    const clearSpy = vi.spyOn(globalThis, "clearTimeout");
    render(<LaunchSplash />);
    fireEvent.click(screen.getByTestId("launch-splash"));
    expect(removeSpy).toHaveBeenCalledWith("keydown", expect.any(Function));
    // Both the auto-close and the scramble-start timers are cleared on close.
    expect(clearSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
    // A later key press must not touch the (now hidden) splash.
    delete document.documentElement.dataset.splash;
    fireEvent.keyDown(window, { key: "a" });
    expect(document.documentElement.dataset.splash).toBeUndefined();
  });

  it("times out from navigation start, not from late hydration", () => {
    vi.mocked(performance.now).mockReturnValue(2000);
    vi.spyOn(Math, "random").mockReturnValue(0.99);
    render(<LaunchSplash />);
    const word = screen.getByTestId("splash-wordmark");
    act(() => vi.advanceTimersByTime(399));
    expect(word.textContent).toBe("QUESTRIX"); // scramble skipped
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByTestId("launch-splash")).not.toBeInTheDocument();
  });

  it("closes immediately when hydration is later than the animation", () => {
    vi.mocked(performance.now).mockReturnValue(5000);
    render(<LaunchSplash />);
    act(() => vi.advanceTimersByTime(0));
    expect(screen.queryByTestId("launch-splash")).not.toBeInTheDocument();
  });

  it("is skipped by a key press", () => {
    render(<LaunchSplash />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByTestId("launch-splash")).not.toBeInTheDocument();
  });

  it("renders nothing when already seen this session", () => {
    document.documentElement.dataset.splash = "seen";
    render(<LaunchSplash />);
    expect(screen.queryByTestId("launch-splash")).not.toBeInTheDocument();
  });

  it("scrambles the wordmark, then locks in QUESTRIX", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.99); // always "&"
    render(<LaunchSplash />);
    const word = screen.getByTestId("splash-wordmark");
    act(() => vi.advanceTimersByTime(1100));
    expect(word.textContent).not.toBe("QUESTRIX");
    act(() => vi.advanceTimersByTime(700));
    expect(word.textContent).toBe("QUESTRIX");
  });

  describe("reduced motion", () => {
    beforeEach(() => mockReducedMotion(true));

    it("shows the static wordmark without scrambling", () => {
      vi.spyOn(Math, "random").mockReturnValue(0.99);
      render(<LaunchSplash />);
      const word = screen.getByTestId("splash-wordmark");
      act(() => vi.advanceTimersByTime(500));
      expect(word.textContent).toBe("QUESTRIX");
    });

    it("closes after 600 ms + fade instead of 2.4 s", () => {
      render(<LaunchSplash />);
      act(() => vi.advanceTimersByTime(600));
      expect(screen.getByTestId("launch-splash")).toBeInTheDocument();
      act(() => vi.advanceTimersByTime(SPLASH_REDUCED_MS - 600));
      expect(screen.queryByTestId("launch-splash")).not.toBeInTheDocument();
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
