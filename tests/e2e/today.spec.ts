import { devices, expect, test, type Page } from "@playwright/test";

import {
  signUpAndOnboard,
  skipSplash,
  skipStarterHabits,
} from "./helpers/session";

// Phase 4 acceptance (#72): complete and undo a habit on an iPhone viewport,
// with taps. The desktop project ignores this file (playwright.config.ts).
test.beforeEach(async ({ page }) => skipSplash(page));

const HABIT = "Drink water";

// The Today screen's own live region (toasts add their own status regions,
// and routes hidden by Activity keep theirs in the DOM).
const announcement = (page: Page) =>
  page
    .locator('p[role="status"][aria-live="polite"]')
    .filter({ visible: true });

async function profileStreak(page: Page) {
  await page.getByRole("link", { name: "Profile", exact: true }).tap();
  await expect(page).toHaveURL(/\/profile$/);
  const streak = page
    .locator("dl > div")
    .filter({ has: page.locator("dt", { hasText: /^Streak$/ }) })
    .locator("dd")
    .first();
  return streak;
}

test("complete and undo a habit on iPhone 13", async ({ page }, testInfo) => {
  test.slow();
  expect(page.viewportSize()).toEqual(devices["iPhone 13"].viewport);
  expect(testInfo.project.use.hasTouch).toBe(true);

  await signUpAndOnboard(page, testInfo);
  await skipStarterHabits(page);

  // A habit due every day, twice, so the pips show progress.
  await page.goto("/habits/new");
  await page.getByLabel("Name").fill(HABIT);
  await page.getByLabel("Times per day").selectOption("2");
  await page.getByRole("button", { name: "Add habit", exact: true }).tap();
  await expect(page).toHaveURL(/\/habits$/);

  await page.getByRole("link", { name: "Today", exact: true }).tap();
  await expect(page).toHaveURL(/\/today$/);
  // .first(): React streaming can briefly hold a hidden copy.
  const balance = page.getByTestId("balance").first();
  const streak = page.getByTestId("streak").first();
  await expect(balance).toHaveText("0 pts");
  await expect(streak).toContainText("0 days");

  // Complete once: progress, points, streak and the floating award.
  await page
    .getByRole("button", { name: `Complete ${HABIT}, 0 of 2 done` })
    .tap();
  await expect(
    page.getByRole("button", { name: /^Complete Drink water, 1 of 2 done/ }),
  ).toBeVisible();
  await expect(announcement(page)).toContainText(
    `${HABIT}: 1 of 2 done. +20 points. 1-day streak.`,
  );
  await expect(balance).toHaveText("20 pts");
  await expect(streak).toContainText("1 day");
  await expect(
    page.getByRole("progressbar", { name: "Level 1 progress" }),
  ).toHaveAttribute("aria-valuenow", "20");

  // The streak is server state: Profile shows it too.
  await expect(await profileStreak(page)).toHaveText("1");
  await page.getByRole("link", { name: "Today", exact: true }).tap();
  await expect(page).toHaveURL(/\/today$/);

  // Undo restores everything.
  await page.getByRole("button", { name: `Undo ${HABIT}` }).tap();
  await expect(
    page.getByRole("button", { name: `Complete ${HABIT}, 0 of 2 done` }),
  ).toBeVisible();
  await expect(announcement(page)).toContainText(`Undid ${HABIT}.`);
  await expect(balance).toHaveText("0 pts");
  await expect(streak).toContainText("0 days");
  await expect(page.getByRole("button", { name: `Undo ${HABIT}` })).toHaveCount(
    0,
  );

  // Profile (preserved by Activity since the last visit) shows the undo.
  await expect(await profileStreak(page)).toHaveText("0");
  await page.getByRole("link", { name: "Today", exact: true }).tap();

  // Complete twice: the occurrence freed by the undo is reused, and the
  // habit is done for the day. Both survive a reload.
  await page
    .getByRole("button", { name: `Complete ${HABIT}, 0 of 2 done` })
    .tap();
  await page
    .getByRole("button", { name: /^Complete Drink water, 1 of 2 done/ })
    .tap();
  await expect(
    page.getByRole("button", { name: /^Drink water, done for today/ }),
  ).toBeVisible();
  await expect(page.getByText("1 of 1 done").first()).toBeVisible();

  await page.reload();
  await expect(
    page.getByRole("button", { name: /^Drink water, done for today/ }).first(),
  ).toBeVisible();
  await expect(balance).toHaveText("40 pts");
  await expect(streak).toContainText("1 day");
  // Only the latest completion can be undone.
  await expect(page.getByRole("button", { name: `Undo ${HABIT}` })).toHaveCount(
    1,
  );
});
