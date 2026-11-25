import { devices, expect, test, type Page } from "@playwright/test";

import {
  signUpAndOnboard,
  skipSplash,
  skipStarterHabits,
} from "./helpers/session";

// Phase 5 acceptance (#93): notifications on an iPhone viewport. Headless
// Chromium has no push service, so PushManager is replaced by a fake that
// returns an allowlisted endpoint; everything from there on is real: the
// service worker, permission in the tap, POST /api/push/subscribe, the
// save_push_subscription RPC and the Settings switches. The desktop project
// ignores this file (playwright.config.ts).

/**
 * Pretend to be the installed app (iOS push needs a Home Screen app) with a
 * working push service. The fake subscription survives reloads in
 * localStorage, as a real one does in the browser.
 */
async function installedWithFakePush(page: Page) {
  await page.addInitScript(() => {
    const STORE = "qx-e2e-fake-push";
    const realMatchMedia = window.matchMedia.bind(window);
    window.matchMedia = (query: string) =>
      query.includes("display-mode: standalone")
        ? ({
            matches: true,
            media: query,
            onchange: null,
            addEventListener() {},
            removeEventListener() {},
            addListener() {},
            removeListener() {},
            dispatchEvent: () => false,
          } as MediaQueryList)
        : realMatchMedia(query);
    Object.defineProperty(navigator, "standalone", { get: () => true });
    // Notification permission as an allowed, installed app sees it. CI's
    // headless Chromium reports "denied" after a reload even with
    // grantPermissions, so the state is faked here; asking only inside the
    // tap is covered by the unit tests (EnableNotifications, client).
    Object.defineProperty(Notification, "permission", {
      get: () => "granted",
    });
    Notification.requestPermission = async () => "granted";

    type Stored = { endpoint: string; key: number[] };
    const read = (): Stored | null => {
      try {
        return JSON.parse(localStorage.getItem(STORE) ?? "null");
      } catch {
        return null;
      }
    };
    const fake = (s: Stored) => ({
      endpoint: s.endpoint,
      options: {
        applicationServerKey: new Uint8Array(s.key).buffer,
        userVisibleOnly: true,
      },
      expirationTime: null,
      toJSON: () => ({
        endpoint: s.endpoint,
        expirationTime: null,
        // The sizes save_push_subscription requires (P2).
        keys: { p256dh: "B" + "A".repeat(86), auth: "A".repeat(22) },
      }),
      unsubscribe: async () => {
        localStorage.removeItem(STORE);
        return true;
      },
    });
    const proto = PushManager.prototype as unknown as Record<string, unknown>;
    proto.getSubscription = async function () {
      const s = read();
      return s ? fake(s) : null;
    };
    proto.subscribe = async function (opts: {
      applicationServerKey: ArrayBuffer | Uint8Array;
    }) {
      const raw = opts.applicationServerKey;
      const key = Array.from(
        raw instanceof Uint8Array ? raw : new Uint8Array(raw),
      );
      const s = {
        endpoint: `https://fcm.googleapis.com/fcm/send/e2e-${crypto.randomUUID()}`,
        key,
      };
      localStorage.setItem(STORE, JSON.stringify(s));
      return fake(s);
    };
  });
}

/** No horizontal page scroll at the iPhone's width. */
async function expectNoOverflow(page: Page) {
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

/** A Server Action's response (the switches save through them). */
const actionDone = (page: Page) =>
  page.waitForResponse(
    (r) =>
      r.request().method() === "POST" &&
      Boolean(r.request().headers()["next-action"]),
  );

/** The device's subscription saved (or re-claimed) on the server. */
const subscribeSaved = (page: Page) =>
  page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/push/subscribe") &&
      r.request().method() === "POST",
  );

const saveError = (page: Page) => page.getByText("Couldn't save. Try again.");

const sw = (page: Page, name: string) =>
  page.getByRole("switch", { name, exact: true });

test.beforeEach(async ({ page }) => skipSplash(page));

test("enable notifications and keep settings on iPhone 13", async ({
  page,
  context,
}, testInfo) => {
  test.slow();
  expect(page.viewportSize()).toEqual(devices["iPhone 13"].viewport);
  await context.grantPermissions(["notifications"]);
  await installedWithFakePush(page);

  await signUpAndOnboard(page, testInfo);
  // Step 2 → step 3 (no overflow) → Today.
  await page.getByRole("link", { name: "Skip for now" }).tap();
  await expect(page).toHaveURL(/\/onboarding\/notifications$/);
  await expect(
    page.getByRole("heading", { name: "Stay on track" }),
  ).toBeVisible();
  await expectNoOverflow(page);
  await page.getByRole("link", { name: "Continue" }).tap();
  await expect(page).toHaveURL(/\/today$/);

  // Settings is linked from Profile; go straight there.
  await page.goto("/settings");
  await expect(page).toHaveURL(/\/settings$/);

  // The service worker activates, then Enable is offered; permission is
  // granted, the fake push service subscribes, and the server saves it.
  const enable = page.getByRole("button", { name: "Enable notifications" });
  await expect(enable).toBeVisible({ timeout: 20_000 });
  // Measured on the loaded page, not the Suspense skeleton.
  await expectNoOverflow(page);
  const saved = subscribeSaved(page);
  await enable.tap();
  expect((await saved).status()).toBe(200);
  await expect(
    page.getByText("Notifications are on for this device."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Turn off notifications on this device" }),
  ).toBeVisible();

  // Pausing all reminders saves, disables the streak saver, and survives a
  // reload.
  await expect(sw(page, "Habit reminders")).toHaveAttribute(
    "aria-checked",
    "true",
  );
  // The switches are optimistic: wait for each save before reloading, or
  // the reload can overtake it (as in habits.spec.ts).
  let done = actionDone(page);
  await sw(page, "Habit reminders").tap();
  await expect(sw(page, "Habit reminders")).toHaveAttribute(
    "aria-checked",
    "false",
  );
  await expect(sw(page, "Streak saver")).toHaveAttribute(
    "aria-disabled",
    "true",
  );
  await done;
  await expect(saveError(page)).toBeHidden();

  // Still subscribed after the reload, and re-claimed for this user.
  const claimed = subscribeSaved(page);
  await page.reload();
  await expect(sw(page, "Habit reminders")).toHaveAttribute(
    "aria-checked",
    "false",
  );
  await expect(
    page.getByRole("button", { name: "Turn off notifications on this device" }),
  ).toBeVisible({ timeout: 20_000 });
  expect((await claimed).status()).toBe(200);
  await expect(
    page.getByText("Couldn't link this device's notifications", {
      exact: false,
    }),
  ).toBeHidden();

  done = actionDone(page);
  await sw(page, "Habit reminders").tap();
  await expect(sw(page, "Habit reminders")).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await done;
  done = actionDone(page);
  await sw(page, "Streak saver").tap();
  await expect(sw(page, "Streak saver")).toHaveAttribute(
    "aria-checked",
    "false",
  );
  await done;
  await expect(saveError(page)).toBeHidden();
  await page.reload();
  await expect(sw(page, "Streak saver")).toHaveAttribute(
    "aria-checked",
    "false",
  );

  // Turning the device off unsubscribes it and removes it on the server.
  await page
    .getByRole("button", { name: "Turn off notifications on this device" })
    .tap();
  await expect(
    page.getByText("Notifications are off for this device."),
  ).toBeVisible();
});

test("an iPhone outside the installed app is shown how to install", async ({
  page,
}, testInfo) => {
  test.slow();
  await signUpAndOnboard(page, testInfo);
  await skipStarterHabits(page);
  // Settings is linked from Profile; go straight there.
  await page.goto("/settings");
  await expect(page).toHaveURL(/\/settings$/);

  await expect(
    page.getByText(
      "On iPhone, notifications work once Questrix is on your Home Screen.",
    ),
  ).toBeVisible();
  await page.getByRole("button", { name: "How to install" }).tap();
  const sheet = page.getByRole("dialog", { name: "Install Questrix" });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByText("Add to Home Screen")).toBeVisible();
  await expectNoOverflow(page);
});
