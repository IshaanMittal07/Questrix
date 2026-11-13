import { expect, test } from "@playwright/test";
import { waitForSignInCode } from "./helpers/mailpit";

// Skip the launch splash in E2E (it plays once per session).
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try {
      sessionStorage.setItem("qx-splash-seen", "1");
    } catch {}
  });
});

test("signed-out visitors are sent to /login", async ({ page }) => {
  await page.goto("/today");
  await expect(page).toHaveURL(/\/login$/);
  await expect(
    page.getByRole("button", { name: "Continue with Google" }),
  ).toBeVisible();
});

test("sign up with an email code → pick a username → land on Today", async ({
  page,
}, testInfo) => {
  const id = `${Date.now().toString(36)}${testInfo.project.name === "iphone-13" ? "i" : "d"}`;
  const email = `e2e-${id}@example.com`;
  const username = `e2e_${id}`.slice(0, 20);

  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Email me a sign-in code" }).click();
  await expect(page.getByText("Check your inbox")).toBeVisible();

  const code = await waitForSignInCode(email);
  await page.getByLabel("6-digit code").fill(code);
  await page.getByRole("button", { name: "Sign in" }).click();

  // New users are routed to onboarding by proxy.ts.
  await expect(page).toHaveURL(/\/onboarding$/);
  await expect(
    page.getByRole("heading", { name: "Create your hero" }),
  ).toBeVisible();

  await page.getByText("Umbra").click();
  await page.getByLabel("Username").fill(username);
  await expect(page.getByText("Available!")).toBeVisible();
  await page.getByRole("button", { name: "Start my quest" }).click();

  await expect(page).toHaveURL(/\/today$/);
  await expect(page.getByText(username).first()).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Main" }).getByRole("link", {
      name: "Today",
    }),
  ).toHaveAttribute("aria-current", "page");

  // Onboarding is done: visiting it again bounces to Today.
  await page.goto("/onboarding");
  await expect(page).toHaveURL(/\/today$/);

  // Username shows on the profile, and sign-out returns to /login.
  await page.getByRole("link", { name: "Profile" }).click();
  await expect(page.getByText(`@${username}`)).toBeVisible();
  await page.getByRole("link", { name: "Settings" }).click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/);
});
