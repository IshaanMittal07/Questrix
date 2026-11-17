import { expect, test } from "@playwright/test";

import { signUpAndOnboard, skipSplash } from "./helpers/session";

test.beforeEach(async ({ page }) => skipSplash(page));

test("create, edit, reorder, archive and restore habits", async ({
  page,
}, testInfo) => {
  await signUpAndOnboard(page, testInfo);
  await expect(page).toHaveURL(/\/today$/);

  await page.goto("/habits");
  await expect(page.getByText(/No habits yet/)).toBeVisible();

  // A custom habit.
  await page.getByRole("link", { name: "Add habit" }).click();
  await expect(page).toHaveURL(/\/habits\/new$/);
  await page.getByLabel("Name").fill("Study");
  await expect(page.getByText(/Specific habits stick/)).toBeVisible();
  await page.getByLabel("Name").fill("Practise guitar 20 min");
  await expect(page.getByText(/Specific habits stick/)).toBeHidden();
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
  await page.keyboard.press("Enter");
  await expect(list.getByRole("link").last()).toContainText(
    "Practise guitar 20 min",
  );
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

  // An unknown or malformed id is a 404, not a crash.
  await page.goto("/habits/not-a-uuid/edit");
  await expect(page.getByText(/could not be found|404/i).first()).toBeVisible();
});
