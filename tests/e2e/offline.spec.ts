import { expect, type Page, test } from "@playwright/test";

import {
  signUpAndOnboard,
  skipSplash,
  skipStarterHabits,
} from "./helpers/session";

// Plan §9: Today stays viewable offline from its last copy, with a banner,
// and nothing pretends to save (DECISIONS H11). The service worker is only
// registered in production builds, which is what the E2E runs.
test.beforeEach(async ({ page }) => skipSplash(page));

/** Waits for the worker to control the page, then loads Today through it. */
async function keepTodayCopy(page: Page) {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise((r) =>
        navigator.serviceWorker.addEventListener("controllerchange", r, {
          once: true,
        }),
      );
    }
  });
  await page.reload();
  await expect(page.getByTestId("balance").first()).toBeVisible();
  // The copy is written in waitUntil, after the page arrives.
  await expect
    .poll(() =>
      page.evaluate(async () =>
        Boolean(await caches.match("/today", { cacheName: "questrix-pages" })),
      ),
    )
    .toBe(true);
}

test("Today opens offline from its last copy", async ({
  page,
  context,
}, testInfo) => {
  test.slow();
  await signUpAndOnboard(page, testInfo);
  await skipStarterHabits(page);
  await keepTodayCopy(page);

  await context.setOffline(true);
  await page.reload();
  await expect(page).toHaveURL(/\/today$/);
  await expect(page.getByTestId("balance").first()).toBeVisible();
  await expect(page.getByTestId("offline-banner").first()).toContainText(
    "You're offline",
  );

  // Back online, the banner goes away.
  await context.setOffline(false);
  await expect(page.getByTestId("offline-banner").first()).not.toContainText(
    "offline",
  );
});

test("signing out removes the offline Today", async ({
  page,
  context,
}, testInfo) => {
  test.slow();
  await signUpAndOnboard(page, testInfo);
  await skipStarterHabits(page);
  await keepTodayCopy(page);

  await page.goto("/settings");
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/);

  await context.setOffline(true);
  await page.goto("/today").catch(() => undefined);
  await expect(page.getByTestId("balance")).toHaveCount(0);
});

test("an ended session removes the offline Today", async ({
  page,
  context,
}, testInfo) => {
  test.slow();
  await signUpAndOnboard(page, testInfo);
  await skipStarterHabits(page);
  await keepTodayCopy(page);

  // The session ends without Sign out (expired or revoked): Today now
  // redirects to /login, and the worker must drop its copy.
  await context.clearCookies();
  await page.goto("/today");
  await expect(page).toHaveURL(/\/login/);
  await expect
    .poll(() =>
      page.evaluate(async () =>
        Boolean(await caches.match("/today", { cacheName: "questrix-pages" })),
      ),
    )
    .toBe(false);

  await context.setOffline(true);
  await page.goto("/today").catch(() => undefined);
  await expect(page.getByTestId("balance")).toHaveCount(0);
});
