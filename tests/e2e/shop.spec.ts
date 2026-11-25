import { devices, expect, test } from "@playwright/test";

import { creditPoints } from "./helpers/db";
import {
  signUpAndOnboard,
  skipSplash,
  skipStarterHabits,
} from "./helpers/session";

// Phase 6 acceptance: buy, equip and see it on the profile, on iPhone 13.
test.beforeEach(async ({ page }) => skipSplash(page));

test("buy and equip a cosmetic, buy a streak freeze", async ({
  page,
}, testInfo) => {
  test.slow();
  expect(page.viewportSize()).toEqual(devices["iPhone 13"].viewport);

  const { username } = await signUpAndOnboard(page, testInfo);
  await skipStarterHabits(page);
  creditPoints(username, 1000);

  await page.getByRole("link", { name: "Shop", exact: true }).tap();
  await expect(page).toHaveURL(/\/shop$/);
  await expect(page.getByTestId("shop-balance")).toContainText("1,000");

  // Try on, then buy, the Neon Hoodie (200).
  await page.getByRole("button", { name: /^Neon Hoodie, Common/ }).tap();
  await page.getByRole("button", { name: "Buy for 200" }).tap();
  const sheet = page.getByRole("dialog", { name: "Buy Neon Hoodie?" });
  await expect(sheet).toContainText("Balance after: 800");
  await sheet.getByRole("button", { name: "Buy for 200" }).tap();
  await expect(page.getByTestId("shop-balance")).toContainText("800");

  await page.getByRole("button", { name: "Equip", exact: true }).tap();
  await expect(
    page.getByRole("button", { name: "Neon Hoodie, Common, Equipped" }),
  ).toBeVisible();

  // A name colour.
  await page.getByRole("tab", { name: "Name" }).tap();
  await page.getByRole("button", { name: /^Cyan, Common/ }).tap();
  await page.getByRole("button", { name: "Buy for 150" }).tap();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Buy for 150" })
    .tap();
  await expect(page.getByTestId("shop-balance")).toContainText("650");
  await page.getByRole("button", { name: "Equip", exact: true }).tap();
  await expect(
    page.getByRole("button", { name: "Cyan, Common, Equipped" }),
  ).toBeVisible();

  // Locked by level.
  await page.getByRole("tab", { name: "Titles" }).tap();
  await page.getByRole("button", { name: /^Streak Lord/ }).tap();
  await expect(page.getByText("Unlocks at level 10")).toBeVisible();

  // A streak freeze (400).
  await page.getByRole("tab", { name: "Power-ups" }).tap();
  await page.getByRole("button", { name: /^Streak Freeze/ }).tap();
  await page.getByRole("button", { name: /Buy for 400/ }).tap();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Buy for 400" })
    .tap();
  await expect(page.getByTestId("shop-balance")).toContainText("250");
  await expect(
    page.getByRole("button", { name: /Buy for 400/ }),
  ).toBeDisabled();

  // The profile shows what's equipped (server state).
  await page.getByRole("link", { name: "Profile", exact: true }).tap();
  await expect(page).toHaveURL(/\/profile$/);
  await expect(
    page.getByTestId("profile-name").locator(".name-color-cyan"),
  ).toBeVisible();
  await expect(page.getByTestId("heatmap")).toBeAttached();
  await expect(
    page
      .getByRole("term")
      .filter({ hasText: /^Freezes$/ })
      .locator("xpath=following-sibling::dd[1]"),
  ).toHaveText("1");

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(overflow).toBe(false);
});
