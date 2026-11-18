import { devices, expect, test, type Page } from "@playwright/test";

import {
  signUpAndOnboard,
  skipSplash,
  skipStarterHabits,
} from "./helpers/session";

// Phase 4 acceptance (#72): complete and undo a habit on an iPhone viewport,
// with taps. The desktop project ignores this file (playwright.config.ts).

/**
 * A device timezone where it's about midday now. Onboarding saves the
 * device's zone, and undo is refused across local midnight (QX105), so the
 * run must not straddle it. Etc/GMT signs are inverted: Etc/GMT-5 is UTC+5.
 */
function middayZone(now = new Date()) {
  const offset = 12 - now.getUTCHours(); // -11..12
  if (offset === 0) return "Etc/GMT";
  return `Etc/GMT${offset > 0 ? "-" : "+"}${Math.abs(offset)}`;
}

test.use({ timezoneId: middayZone() });
test.beforeEach(async ({ page }) => skipSplash(page));

const HABIT = "Drink water";

/** The Today screen's announcement (hidden Activity routes are excluded). */
const announced = (page: Page, text: string) =>
  expect(
    page.getByRole("status").filter({ hasText: text }).first(),
  ).toBeAttached();

async function openTab(page: Page, name: string, url: RegExp) {
  await page.getByRole("link", { name, exact: true }).tap();
  await expect(page).toHaveURL(url);
}

/** Profile's Streak stat (server state). */
const profileStreak = (page: Page) =>
  page
    .getByRole("term")
    .filter({ hasText: /^Streak$/ })
    .locator("xpath=following-sibling::dd[1]");

test("complete and undo a habit on iPhone 13", async ({ page }, testInfo) => {
  test.slow();
  expect(page.viewportSize()).toEqual(devices["iPhone 13"].viewport);
  expect(testInfo.project.use.hasTouch).toBe(true);

  await signUpAndOnboard(page, testInfo);
  await skipStarterHabits(page);

  // A habit due every day, twice, so the pips show progress. Reached by
  // client navigation, so the form is hydrated before typing.
  await page.getByRole("link", { name: "Add a habit" }).first().tap();
  await expect(page).toHaveURL(/\/habits\/new$/);
  await page.getByLabel("Name", { exact: true }).fill(HABIT);
  await page.getByLabel("Times per day").selectOption("2");
  await page.getByRole("button", { name: "Add habit", exact: true }).tap();
  await expect(page).toHaveURL(/\/habits$/);

  await openTab(page, "Today", /\/today$/);
  // .first(): React streaming can briefly hold a hidden copy.
  const balance = page.getByTestId("balance").first();
  const streak = page.getByTestId("streak").first();
  const ring = page.getByRole("progressbar", { name: "Level 1 progress" });
  await expect(balance).toHaveText("0 pts");
  await expect(streak).toContainText("0 days");

  // Complete once: progress, points, streak and the level ring. The
  // announcement and balance only change once the server has answered.
  await page
    .getByRole("button", { name: `Complete ${HABIT}, 0 of 2 done` })
    .tap();
  await expect(
    page.getByRole("button", { name: /^Complete Drink water, 1 of 2 done/ }),
  ).toBeVisible();
  await announced(page, `${HABIT}: 1 of 2 done. +20 points. 1-day streak.`);
  await expect(balance).toHaveText("20 pts");
  await expect(streak).toContainText("1 day");
  await expect(ring).toHaveAttribute("aria-valuenow", "20");

  // The streak is server state: Profile shows it too.
  await openTab(page, "Profile", /\/profile$/);
  await expect(profileStreak(page)).toHaveText("1");
  await openTab(page, "Today", /\/today$/);

  // Undo restores everything.
  await page.getByRole("button", { name: `Undo ${HABIT}` }).tap();
  await announced(page, `Undid ${HABIT}.`);
  await expect(
    page.getByRole("button", { name: `Complete ${HABIT}, 0 of 2 done` }),
  ).toBeVisible();
  await expect(balance).toHaveText("0 pts");
  await expect(streak).toContainText("0 days");
  await expect(ring).toHaveAttribute("aria-valuenow", "0");
  await expect(page.getByRole("button", { name: `Undo ${HABIT}` })).toHaveCount(
    0,
  );

  // Profile (kept by Activity since the last visit) shows the undo too.
  await openTab(page, "Profile", /\/profile$/);
  await expect(profileStreak(page)).toHaveText("0");
  await openTab(page, "Today", /\/today$/);

  // Complete twice, each confirmed by the server before the next step, and
  // the day is done.
  await page
    .getByRole("button", { name: `Complete ${HABIT}, 0 of 2 done` })
    .tap();
  await announced(page, `${HABIT}: 1 of 2 done. +20 points.`);
  await page
    .getByRole("button", { name: /^Complete Drink water, 1 of 2 done/ })
    .tap();
  await announced(page, `${HABIT}: 2 of 2 done. +20 points. 1-day streak.`);
  await expect(balance).toHaveText("40 pts");
  await expect(
    page.getByRole("button", { name: /^Drink water, done for today/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "1 of 1 done" }),
  ).toBeVisible();

  // It all survives a reload, and only the latest completion can be undone.
  await page.reload();
  await expect(
    page.getByRole("button", { name: /^Drink water, done for today/ }).first(),
  ).toBeVisible();
  await expect(balance).toHaveText("40 pts");
  await expect(streak).toContainText("1 day");
  await expect(ring).toHaveAttribute("aria-valuenow", "40");
  await expect(page.getByRole("button", { name: `Undo ${HABIT}` })).toHaveCount(
    1,
  );
});
