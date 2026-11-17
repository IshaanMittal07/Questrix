import { expect, test } from "@playwright/test";

import {
  signUpAndOnboard,
  skipSplash,
  skipStarterHabits,
} from "./helpers/session";

test.beforeEach(async ({ page }) => skipSplash(page));

test("create, edit, reorder, archive and restore habits", async ({
  page,
}, testInfo) => {
  // A long flow (sign-up plus a dozen round trips): near the 60s default
  // when the suite runs in parallel.
  test.slow();
  await signUpAndOnboard(page, testInfo);
  await skipStarterHabits(page);

  await page.goto("/habits");
  // .first(): during streaming React briefly holds a hidden copy of the
  // content, which getByText also matches.
  await expect(page.getByText(/No habits yet/).first()).toBeVisible();

  // A custom habit.
  await page.getByRole("link", { name: "Add habit" }).click();
  await expect(page).toHaveURL(/\/habits\/new$/);
  await page.getByLabel("Name").fill("Study");
  // The visible hint, and its one-off announcement in the status region.
  await expect(page.getByText(/Specific habits stick/).first()).toBeVisible();
  await expect(
    page.getByRole("status").filter({ hasText: /Specific habits stick/ }),
  ).toHaveCount(1);
  await page.getByLabel("Name").fill("Practise guitar 20 min");
  await expect(
    page.getByTestId("coaching-hints").getByText(/Specific habits stick/),
  ).toHaveCount(0);
  await page.getByLabel("Category").selectOption("learning");
  await page.getByRole("button", { name: "Add habit" }).click();
  await expect(page).toHaveURL(/\/habits$/);

  // A second one from a suggestion.
  await page.getByRole("link", { name: "Add habit" }).click();
  const suggested = page.getByRole("list", { name: "Suggested for you" });
  await suggested.getByRole("button").first().click();
  const picked = await page.getByLabel("Name").inputValue();
  expect(picked.length).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Add habit" }).click();
  await expect(page).toHaveURL(/\/habits$/);

  const list = page.getByRole("list", { name: "Your habits" });
  await expect(list.getByRole("listitem")).toHaveCount(2);
  await expect(list.getByRole("link").first()).toContainText(
    "Practise guitar 20 min",
  );

  // Reorder with the keyboard; the order survives a reload.
  await page
    .getByRole("button", { name: "Move Practise guitar 20 min down" })
    .focus();
  // The move is optimistic: wait for the Server Action (a POST) to finish
  // before reloading, or the reload can race it.
  const saved = page.waitForResponse(
    (r) =>
      r.request().method() === "POST" &&
      Boolean(r.request().headers()["next-action"]),
  );
  await page.keyboard.press("Enter");
  await expect(list.getByRole("link").last()).toContainText(
    "Practise guitar 20 min",
  );
  await saved;
  await expect(
    page.getByRole("button", { name: "Move Practise guitar 20 min up" }),
  ).toBeFocused();
  await page.reload();
  await expect(list.getByRole("link").last()).toContainText(
    "Practise guitar 20 min",
  );

  // Edit.
  await list.getByRole("link", { name: /Practise guitar 20 min/ }).click();
  await expect(page).toHaveURL(/\/habits\/[0-9a-f-]+\/edit$/);
  await expect(page.getByLabel("Name")).toHaveValue("Practise guitar 20 min");
  await page.getByLabel("Name").fill("Practise guitar 30 min");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page).toHaveURL(/\/habits$/);
  await expect(list.getByRole("link").last()).toContainText(
    "Practise guitar 30 min",
  );

  // Archive and restore.
  await page
    .getByRole("button", { name: "Archive Practise guitar 30 min" })
    .click();
  await expect(list.getByRole("listitem")).toHaveCount(1);
  await page.getByText("Archived (1)").click();
  await page
    .getByRole("button", { name: "Restore Practise guitar 30 min" })
    .click();
  await expect(list.getByRole("listitem")).toHaveCount(2);

  // An unknown or malformed id shows the not-found page, not a crash.
  await page.goto("/habits/not-a-uuid/edit");
  await expect(
    page.getByText("This page could not be found.").first(),
  ).toBeVisible();
});
