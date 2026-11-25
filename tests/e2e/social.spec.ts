import { expect, test } from "@playwright/test";

import { sql } from "./helpers/db";
import {
  signUpAndOnboard,
  skipSplash,
  skipStarterHabits,
} from "./helpers/session";

// Phase 7 acceptance: a post with markup renders as text (XSS), the feed
// paginates with Load more, and likes/comments work, on iPhone 13.
test.beforeEach(async ({ page }) => skipSplash(page));

const XSS =
  '<img src=x onerror="window.__xss=1"><script>window.__xss=1</script>';

test("post, paginate, like and comment safely", async ({ page }, testInfo) => {
  test.slow();
  const { username } = await signUpAndOnboard(page, testInfo);
  await skipStarterHabits(page);

  // 24 older posts straight into the table, an hour+ apart so they stay under
  // the hourly rate limit when this user posts through the RPC.
  sql(`
    insert into public.posts (author_id, body, created_at)
    select id, 'Older post ' || g, now() - make_interval(hours => g + 1)
    from public.profiles, generate_series(1, 24) g
    where username = '${username}';
  `);

  await page.getByRole("link", { name: "Feed", exact: true }).tap();
  await expect(page).toHaveURL(/\/feed$/);

  await page.getByLabel("Share your progress").fill(`${XSS} day one`);
  await page.getByLabel("Attach my weekly summary").check();
  await page.getByRole("button", { name: "Post", exact: true }).tap();

  const mine = page.getByRole("article").filter({ hasText: "day one" }).first();
  await expect(mine.getByTestId("post-body")).toHaveText(`${XSS} day one`);
  await expect(mine.getByLabel("Weekly summary")).toBeVisible();
  expect(await page.evaluate(() => (window as { __xss?: number }).__xss)).toBe(
    undefined,
  );

  // Like (optimistic, then server state after a reload).
  await mine.getByRole("button", { name: /^Like, 0 likes/ }).tap();
  await expect(
    mine.getByRole("button", { name: /^Unlike, 1 likes/ }),
  ).toBeVisible();

  // Comment.
  await mine.getByRole("button", { name: /^Comments, 0/ }).tap();
  await mine.getByLabel("Add a comment").fill("Proud of this <b>one</b>");
  await mine.getByRole("button", { name: "Send" }).tap();
  await expect(mine.getByText("Proud of this <b>one</b>")).toBeVisible();
  await expect(
    mine.getByRole("button", { name: /^Comments, 1/ }),
  ).toBeVisible();

  // Keyset pagination on Following, which for a new user is only their own
  // 25 posts (Everyone also has other test users' posts): 20, then 5 more.
  await page.reload();
  await page.getByRole("tab", { name: "Following" }).tap();
  const posts = page.getByRole("list", { name: "Posts" }).getByRole("article");
  await expect(posts).toHaveCount(20);
  await page.getByRole("button", { name: "Load more" }).tap();
  await expect(posts).toHaveCount(25);
  await expect(page.getByRole("button", { name: "Load more" })).toBeHidden();
  await expect(
    posts
      .filter({ hasText: "day one" })
      .getByRole("button", { name: /^Unlike, 1 likes/ }),
  ).toBeVisible();

  await page.getByRole("link", { name: "Ranks" }).tap();
  await expect(page).toHaveURL(/\/leaderboard$/);
  await expect(page.getByTestId("my-rank")).toBeVisible();

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(overflow).toBe(false);
});
