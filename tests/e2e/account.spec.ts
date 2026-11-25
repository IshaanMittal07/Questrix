import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

import { sql } from "./helpers/db";
import {
  signUpAndOnboard,
  skipSplash,
  skipStarterHabits,
} from "./helpers/session";

// Phase 8: Settings → Export my data downloads JSON, and Delete account
// removes the user and everything they own (RUNBOOK §5.4, automated).
test.beforeEach(async ({ page }) => skipSplash(page));

test("export my data, then delete the account", async ({ page }, testInfo) => {
  test.slow();
  const { username } = await signUpAndOnboard(page, testInfo);
  await skipStarterHabits(page);

  await page.goto("/settings");
  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: "Export my data (JSON)" }).click();
  const file = await (await download).path();
  const data = JSON.parse(readFileSync(file, "utf8"));
  expect(data.profile.username).toBe(username);
  expect(Array.isArray(data.habits)).toBe(true);

  // The button stays disabled until the username is typed exactly.
  await page.getByText("Delete account", { exact: true }).click();
  const confirm = page.getByLabel("Type your username to confirm");
  const del = page.getByRole("button", { name: "Delete my account forever" });
  await confirm.fill("not-my-name");
  await expect(del).toBeDisabled();
  await confirm.fill(username);
  await del.click();

  await expect(page).toHaveURL(/\/login\?deleted=1$/);
  await expect(
    // .first(): React streaming can briefly hold a hidden copy.
    page.getByText("Your account and its data were deleted.").first(),
  ).toBeVisible();
  expect(
    sql(`select count(*) from public.profiles where username = '${username}'`),
  ).toBe("0");

  // The old session is gone: the app sends us back to sign in.
  await page.goto("/today");
  await expect(page).toHaveURL(/\/login/);
});
