import { devices, expect, test, type Page } from "@playwright/test";

import { creditPoints } from "./helpers/db";
import {
  signUpAndOnboard,
  skipSplash,
  skipStarterHabits,
} from "./helpers/session";

// Phase 8 acceptance: the full journey on an iPhone viewport. Sign up →
// onboarding → complete habits → streak → buy item → equip → post → like.

/** A zone where it's about midday, so the run can't straddle midnight. */
function middayZone(now = new Date()) {
  const offset = 12 - now.getUTCHours();
  if (offset === 0) return "Etc/GMT";
  return `Etc/GMT${offset > 0 ? "-" : "+"}${Math.abs(offset)}`;
}
test.use({ timezoneId: middayZone() });
test.beforeEach(async ({ page }) => skipSplash(page));

async function openTab(page: Page, name: string, url: RegExp) {
  await page.getByRole("link", { name, exact: true }).tap();
  await expect(page).toHaveURL(url);
}

test("the full journey on iPhone 13", async ({ page }, testInfo) => {
  test.slow();
  expect(page.viewportSize()).toEqual(devices["iPhone 13"].viewport);

  // Sign up and onboard.
  const { username } = await signUpAndOnboard(page, testInfo);
  await skipStarterHabits(page);

  // A habit, completed: points and a 1-day streak.
  await page.getByRole("link", { name: "Add a habit" }).first().tap();
  await expect(page).toHaveURL(/\/habits\/new$/);
  await page.getByLabel("Name", { exact: true }).fill("Read 10 pages");
  await page.getByRole("button", { name: "Add habit", exact: true }).tap();
  await expect(page).toHaveURL(/\/habits$/);
  await openTab(page, "Today", /\/today$/);
  await page
    .getByRole("button", { name: /^Complete Read 10 pages, 0 of 1 done/ })
    .tap();
  await expect(page.getByTestId("balance").first()).toHaveText("20 pts");
  await expect(page.getByTestId("streak").first()).toContainText("1 day");

  // Buy and equip (a top-up, since one completion can't afford an item).
  creditPoints(username, 500);
  await openTab(page, "Shop", /\/shop$/);
  await page.getByRole("button", { name: /^Neon Hoodie, Common/ }).tap();
  await page.getByRole("button", { name: "Buy for 200" }).tap();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Buy for 200" })
    .tap();
  await expect(page.getByTestId("shop-balance")).toContainText("320");
  await page.getByRole("button", { name: "Equip", exact: true }).tap();
  await expect(
    page.getByRole("button", { name: "Neon Hoodie, Common, Equipped" }),
  ).toBeVisible();

  // Post with the weekly summary, then like it.
  await openTab(page, "Feed", /\/feed$/);
  await page.getByLabel("Share your progress").fill("Day one done!");
  await page.getByLabel("Attach my weekly summary").check();
  await page.getByRole("button", { name: "Post", exact: true }).tap();
  const post = page
    .getByRole("article")
    .filter({ hasText: "Day one done!" })
    .first();
  await expect(post.getByLabel("Weekly summary")).toContainText("1");
  await post.getByRole("button", { name: /^Like, 0 likes/ }).tap();
  await expect(
    post.getByRole("button", { name: /^Unlike, 1 likes/ }),
  ).toBeVisible();

  // The profile reflects it all (server state).
  await openTab(page, "Profile", /\/profile$/);
  await expect(
    page
      .getByRole("term")
      .filter({ hasText: /^Streak$/ })
      .locator("xpath=following-sibling::dd[1]"),
  ).toHaveText("1");
  await expect(page.getByTestId("heatmap")).toBeAttached();
});
