import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TABS, TabBarView, isActiveTab } from "@/components/ui/TabBar";

describe("TabBar", () => {
  it("renders the five main tabs in order", () => {
    render(<TabBarView pathname="/today" />);
    const nav = screen.getByRole("navigation", { name: "Main" });
    const links = nav.querySelectorAll("a");
    expect([...links].map((a) => a.textContent)).toEqual([
      "Today",
      "Habits",
      "Feed",
      "Shop",
      "Profile",
    ]);
  });

  it("marks only the active tab with aria-current=page", () => {
    render(<TabBarView pathname="/habits/new" />);
    expect(screen.getByRole("link", { name: "Habits" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    for (const name of ["Today", "Feed", "Shop", "Profile"]) {
      expect(screen.getByRole("link", { name })).not.toHaveAttribute(
        "aria-current",
      );
    }
  });

  it("highlights nothing in the static fallback", () => {
    render(<TabBarView pathname={null} />);
    expect(document.querySelector("[aria-current]")).toBeNull();
  });

  it("matches nested routes but not prefixes of other words", () => {
    expect(isActiveTab("/shop", "/shop")).toBe(true);
    expect(isActiveTab("/shop/item", "/shop")).toBe(true);
    expect(isActiveTab("/shopping", "/shop")).toBe(false);
    expect(TABS).toHaveLength(5);
  });
});
