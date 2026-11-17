import { devices, expect, test } from "@playwright/test";

import {
  signUpAndOnboard,
  skipSplash,
  skipStarterHabits,
} from "./helpers/session";

// Phase 3 acceptance (plan §11): create a habit from a template on an iPhone
// viewport. Sign-up uses the shared helper; the habit flow itself is taps.
// The desktop project ignores this file (playwright.config.ts).
test.beforeEach(async ({ page }) => skipSplash(page));

test("create a habit from a template on iPhone 13", async ({
  page,
}, testInfo) => {
  test.slow();
  expect(page.viewportSize()).toEqual(devices["iPhone 13"].viewport);
  expect(testInfo.project.use.hasTouch).toBe(true);

  await signUpAndOnboard(page, testInfo);
  await skipStarterHabits(page);

  await page.getByRole("link", { name: "Habits", exact: true }).tap();
  await expect(page).toHaveURL(/\/habits$/);
  await page.getByRole("link", { name: "Add habit", exact: true }).tap();
  await expect(page).toHaveURL(/\/habits\/new$/);

  // A new user is suggested Meditate (mind is a priority category).
  const suggested = page.getByRole("list", { name: "Suggested for you" });
  await expect(
    suggested.getByRole("button", { name: /Meditate 10 min/ }),
  ).toBeVisible();

  // Pick it from the full library, not the suggestion.
  await page.getByText(/Browse all \d+ templates/).tap();
  await page
    .locator("details")
    .getByRole("button", { name: /Meditate 10 min/ })
    .tap();

  // The template fills every field.
  const label = (name: string) => page.getByLabel(name, { exact: true });
  await expect(label("Name")).toHaveValue("Meditate 10 min");
  await expect(label("Icon")).toHaveValue("🧘");
  await expect(label("Category")).toHaveValue("mind");
  await expect(page.getByRole("radio", { name: "Medium" })).toBeChecked();
  for (const day of [
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
    "Sunday",
  ]) {
    await expect(
      page.getByRole("button", { name: day, exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
  }
  await expect(label("Times per day")).toHaveValue("1");
  await expect(
    page.getByRole("checkbox", { name: "Remind me", exact: true }),
  ).toBeChecked();
  await expect(label("Reminder time 1")).toHaveValue("07:00");
  await expect(label("Reminder time 2")).toHaveCount(0);

  // Nothing overflows the phone's width.
  const fits = () =>
    page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    );
  expect(await fits()).toBe(true);

  await page.getByRole("button", { name: "Add habit", exact: true }).tap();
  await expect(page).toHaveURL(/\/habits$/);

  const list = page.getByRole("list", { name: "Your habits" });
  await expect(list.getByRole("listitem")).toHaveCount(1);
  await expect(
    list.getByRole("link", { name: /Meditate 10 min/ }),
  ).toBeVisible();
  await expect(list.getByText("Every day · 07:00")).toBeVisible();
  expect(await fits()).toBe(true);

  // It was saved on the server: it survives a reload.
  await page.reload();
  await expect(
    page
      .getByRole("list", { name: "Your habits" })
      .getByRole("link", { name: /Meditate 10 min/ }),
  ).toBeVisible();

  // Rule 4: once added, it's no longer suggested. Wait for the suggestions
  // to load first, so an empty, still-loading page can't pass.
  await page.goto("/habits/new");
  await expect(suggested.getByRole("button").first()).toBeVisible();
  await expect(
    suggested.getByRole("button", { name: /Meditate 10 min/ }),
  ).toHaveCount(0);
});
