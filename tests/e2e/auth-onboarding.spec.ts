import { expect, test } from "@playwright/test";
import { waitForSignInCode, waitForSignInLink } from "./helpers/mailpit";

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

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

test("the login redirect remembers the page that was asked for", async ({
  page,
}) => {
  await page.goto("/shop?tab=outfit");
  await expect(page).toHaveURL(/\/login\?next=%2Fshop%3Ftab%3Doutfit$/);
});

test("unknown ?error= values render the normal login page", async ({
  page,
}) => {
  for (const key of ["__proto__", "constructor", "nope"]) {
    await page.goto(`/login?error=${key}`);
    await expect(
      page.getByRole("button", { name: "Continue with Google" }),
    ).toBeVisible();
    await expect(page.locator("main [role=alert]")).toHaveCount(0);
  }
});

test("the email link signs in only after a tap, and can't be reused", async ({
  page,
}, testInfo) => {
  const id = `${Date.now().toString(36)}${testInfo.project.name === "iphone-13" ? "i" : "d"}`;
  const email = `e2e-link-${id}@example.com`;

  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Email me a sign-in code" }).click();
  await expect(page.getByText("Check your inbox")).toBeVisible();
  const link = await waitForSignInLink(email);

  // A GET (what a mail scanner does) must not use up the token.
  await page.request.get(link);
  await page.goto(link);
  await expect(
    page.getByRole("heading", { name: "Almost there" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Sign in to Questrix" }).click();
  await expect(page).toHaveURL(/\/onboarding$/);

  // The same link again is spent: back to /login with a message.
  await page.context().clearCookies();
  await page.goto(link);
  await page.getByRole("button", { name: "Sign in to Questrix" }).click();
  await expect(page).toHaveURL(/\/login\?error=link$/);
  await expect(
    page.getByRole("alert").filter({ hasText: "expired or was already used" }),
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

  // Step 2: pick starter habits. At most 3; a 4th can't be picked.
  await expect(page).toHaveURL(/\/onboarding\/habits$/);
  const suggested = page.getByRole("group", { name: "Suggested for you" });
  const boxes = suggested.getByRole("checkbox");
  for (const i of [0, 1, 2]) await boxes.nth(i).click();
  // A 4th is unavailable (aria-disabled, so it stays focusable).
  await expect(boxes.nth(3)).toBeDisabled();
  await expect(boxes.nth(3)).not.toBeChecked();
  await expect(
    page.getByText("3 of 3 picked.", { exact: false }),
  ).toBeVisible();
  await boxes.nth(2).click();
  await expect(boxes.nth(2)).not.toBeChecked();
  // Remember which habits were picked, to find them on /habits later.
  const titles = await Promise.all(
    [0, 1].map((i) =>
      boxes
        .nth(i)
        .evaluate(
          (el) =>
            el.closest("label")?.querySelector(".font-semibold")?.textContent ??
            "",
        ),
    ),
  );
  expect(titles.every(Boolean)).toBe(true);
  await page.getByRole("button", { name: "Add 2 habits" }).click();

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

  // The two starter habits are on the habits list.
  await page.getByRole("link", { name: "Habits" }).click();
  await expect(
    page.getByRole("list", { name: "Your habits" }).getByRole("listitem"),
  ).toHaveCount(2);
  for (const title of titles) {
    await expect(
      page
        .getByRole("list", { name: "Your habits" })
        // Chromium may put a space before the sr-only ", edit".
        .getByRole("link", {
          name: new RegExp(`^${escapeRegExp(title)}\\s*, edit$`),
        }),
    ).toBeVisible();
  }

  // Username shows on the profile, and sign-out returns to /login.
  await page.getByRole("link", { name: "Profile" }).click();
  await expect(page.getByText(`@${username}`)).toBeVisible();
  await page.getByRole("link", { name: "Settings" }).click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/);

  // Signing back in from a deep link returns to that page (#35).
  await page.goto("/shop?tab=outfit");
  await expect(page).toHaveURL(/\/login\?next=%2Fshop%3Ftab%3Doutfit$/);
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Email me a sign-in code" }).click();
  await expect(page.getByText("Check your inbox")).toBeVisible();
  const secondCode = await waitForSignInCode(email, { notCode: code });
  await page.getByLabel("6-digit code").fill(secondCode);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/shop\?tab=outfit$/);
});
