import { expect, test } from "@playwright/test";

import {
  signUpAndOnboard,
  skipSplash,
  skipStarterHabits,
} from "./helpers/session";

// Plan §9: Today stays viewable offline from its last copy, with a banner,
// and nothing pretends to save (DECISIONS H11). The service worker is only
// registered in production builds, which is what the E2E runs.
test.beforeEach(async ({ page }) => skipSplash(page));

test("Today opens offline from its last copy", async ({
  page,
  context,
}, testInfo) => {
  test.slow();
  await signUpAndOnboard(page, testInfo);
  await skipStarterHabits(page);

  // Wait until the service worker controls the page, then load Today once
  // through it so it keeps a copy.
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
