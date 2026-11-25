import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OfflineBanner } from "@/components/ui/OfflineBanner";
import { clearOfflinePages, PAGES_CACHE } from "@/lib/offline/pages";

function setOnline(value: boolean) {
  Object.defineProperty(navigator, "onLine", { configurable: true, value });
}

afterEach(() => {
  setOnline(true);
  vi.unstubAllGlobals();
});

describe("OfflineBanner", () => {
  it("is empty online and explains offline, live", () => {
    render(<OfflineBanner />);
    const banner = screen.getByTestId("offline-banner");
    expect(banner).toHaveTextContent("");
    act(() => {
      setOnline(false);
      window.dispatchEvent(new Event("offline"));
    });
    expect(banner).toHaveTextContent(/You're offline/);
    expect(banner).toHaveAttribute("role", "status");
    act(() => {
      setOnline(true);
      window.dispatchEvent(new Event("online"));
    });
    expect(banner).toHaveTextContent("");
  });
});

describe("clearOfflinePages", () => {
  it("deletes the pages cache", async () => {
    const del = vi.fn(async () => true);
    vi.stubGlobal("caches", { delete: del });
    await clearOfflinePages();
    expect(del).toHaveBeenCalledWith(PAGES_CACHE);
  });

  it("never throws or hangs", async () => {
    vi.stubGlobal("caches", {
      delete: () => Promise.reject(new Error("blocked")),
    });
    await expect(clearOfflinePages()).resolves.toBeUndefined();
    vi.stubGlobal("caches", { delete: () => new Promise(() => {}) });
    await expect(clearOfflinePages(10)).resolves.toBeUndefined();
  });
});
