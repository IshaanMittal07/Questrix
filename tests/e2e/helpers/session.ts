import { expect, type Page, type TestInfo } from "@playwright/test";

import { waitForSignInCode } from "./mailpit";

/** Skip the launch splash (it plays once per session). */
export async function skipSplash(page: Page) {
  await page.addInitScript(() => {
    try {
      sessionStorage.setItem("qx-splash-seen", "1");
    } catch {}
  });
}

/** A short id unique per run and per project, for emails and usernames. */
export function uniqueId(testInfo: TestInfo) {
  const suffix = testInfo.project.name === "iphone-13" ? "i" : "d";
  // Worker index and a random digit keep parallel workers apart.
  const rand = Math.floor(Math.random() * 36).toString(36);
  return `${Date.now().toString(36)}${testInfo.workerIndex.toString(36)}${rand}${suffix}`;
}

/**
 * Signs up a fresh user with an email code and finishes onboarding step 1,
 * ending on step 2 (starter habits). Call skipStarterHabits to reach Today.
 */
export async function signUpAndOnboard(page: Page, testInfo: TestInfo) {
  const id = uniqueId(testInfo);
  const email = `e2e-${id}@example.com`;
  const username = `e2e_${id}`.slice(0, 20);

  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Email me a sign-in code" }).click();
  await expect(page.getByText("Check your inbox")).toBeVisible();
  const code = await waitForSignInCode(email);
  await page.getByLabel("6-digit code").fill(code);
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page).toHaveURL(/\/onboarding$/);
  await page.getByText("Umbra").click();
  await page.getByLabel("Username").fill(username);
  await expect(page.getByText("Available!")).toBeVisible();
  await page.getByRole("button", { name: "Start my quest" }).click();
  await expect(page).toHaveURL(/\/onboarding\/habits$/);
  return { email, username };
}

/** Onboarding steps 2 and 3: skip picking habits and notifications, land on Today. */
export async function skipStarterHabits(page: Page) {
  await page.getByRole("link", { name: "Skip for now" }).click();
  await expect(page).toHaveURL(/\/onboarding\/notifications$/);
  await page.getByRole("link", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/today$/);
}
