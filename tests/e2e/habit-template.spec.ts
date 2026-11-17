import { expect, test } from "@playwright/test";

import {
  signUpAndOnboard,
  skipSplash,
  skipStarterHabits,
} from "./helpers/session";

// Phase 3 acceptance (plan §11): create a habit from a template on an iPhone
// viewport. Touch only: every interaction is a tap.
test.beforeEach(async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "iphone-13", "iPhone 13 only");
  await skipSplash(page);
});

test("create a habit from a template on iPhone 13", async ({
  page,
}, testInfo) => {
  expect(page.viewportSize()).toEqual({ width: 390, height: 664 });

  await signUpAndOnboard(page, testInfo);
  await skipStarterHabits(page);

  await page.getByRole("link", { name: "Habits" }).tap();
  await expect(page).toHaveURL(/\/habits$/);
  await page.getByRole("link", { name: "Add habit" }).tap();
  await expect(page).toHaveURL(/\/habits\/new$/);

  // Pick from the full library, not a suggestion.
  await page.getByText(/Browse all \d+ templates/).tap();
  await page.getByRole("button", { name: /Drink 2 L of water/ }).tap();

  // The template fills every field.
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue(
    "Drink 2 L of water",
  );
  await expect(page.getByLabel("Category", { exact: true })).toHaveValue(
    "nutrition",
  );
  await expect(page.getByLabel("Times per day", { exact: true })).toHaveValue(
    "4",
  );
  for (const [i, t] of ["09:00", "12:00", "15:00", "18:00"].entries()) {
    await expect(
      page.getByLabel(`Reminder time ${i + 1}`, { exact: true }),
    ).toHaveValue(t);
  }
  await expect(page.getByRole("radio", { name: "Easy" })).toBeChecked();

  // Nothing overflows the 390px screen.
  const scrollWidth = await page.evaluate(
    () => document.documentElement.scrollWidth,
  );
  expect(scrollWidth).toBeLessThanOrEqual(390);

  await page.getByRole("button", { name: "Add habit" }).tap();
  await expect(page).toHaveURL(/\/habits$/);

  const list = page.getByRole("list", { name: "Your habits" });
  await expect(list.getByRole("listitem")).toHaveCount(1);
  await expect(
    list.getByRole("link", { name: /Drink 2 L of water/ }),
  ).toBeVisible();
  await expect(
    list.getByText("Every day · 4× a day · 09:00, 12:00, 15:00, 18:00"),
  ).toBeVisible();

  // It stays after a reload (it's on the server, not just in the client).
  await page.reload();
  await expect(
    page
      .getByRole("list", { name: "Your habits" })
      .getByRole("link", { name: /Drink 2 L of water/ }),
  ).toBeVisible();

  // The template is no longer suggested.
  await page.goto("/habits/new");
  await expect(
    page
      .getByRole("list", { name: "Suggested for you" })
      .getByRole("button", { name: /Drink 2 L of water/ }),
  ).toHaveCount(0);
});
