import { expect, test } from "@playwright/test";
import { FAKE_WORKS, openWithWorks, readFakeFile } from "./support/fakeWorks";

/**
 * まだ投稿していない話（2026-11-29 作者の答え「両方に出す」：作品一覧の札に数、話の一覧の行に印）。見分け方は本体の作品一覧の
 * 「未投稿」と同じ（登録したサイトのうち、まだ出していないサイト）。競合の話は数えない。台帳は読むだけ。作品は作り物（`_確認用`）だけ
 */
const LEDGER = "灯台守_確認用/設定/投稿状態.json";
const ledger = JSON.stringify({
  schemaVersion: "1",
  sites: [
    { site: "kakuyomu", newEpisodeUrl: "https://kakuyomu.jp/my/works/1177354054/episodes/new" },
    { site: "narou", newEpisodeUrl: "https://syosetu.com/usernovelmanage/ziwaiinput/ncode/123/" },
  ],
  posts: [
    { episodePath: "本文/第1話 手紙.txt", site: "kakuyomu", postedAt: "2026-11-01T00:00:00.000Z" },
    { episodePath: "本文/第1話 手紙.txt", site: "narou", postedAt: "2026-11-01T00:00:00.000Z" },
    { episodePath: "本文/第2話 灯台の階段は百二十段あり、のぼるたびに数え直してしまう.txt", site: "narou", postedAt: "2026-11-02T00:00:00.000Z" },
  ],
  rankings: [],
});

test("作品一覧の札に未投稿の話の数、話の一覧の行に印（台帳は変えない）", async ({ page }) => {
  await openWithWorks(page, "#/works", { ...FAKE_WORKS, [LEDGER]: ledger });
  const card = page.locator(".work-card", { hasText: "灯台守の手紙_確認用" });
  // 第2話（なろうだけ出した）と第3話（どこにも出していない）。第4話は競合なので数えない
  await expect(card.locator("[data-unposted-flag]")).toHaveText("未投稿：2話");
  // 台帳の無い作品には出さない
  await expect(page.locator(".work-card", { hasText: "雨の駅" }).locator("[data-unposted-flag]")).toHaveCount(0);

  await card.click();
  const rows = page.locator(".ep-list .ep");
  await expect(rows.filter({ hasText: "第3話" }).locator("[data-unposted]")).toHaveText("未投稿");
  await expect(rows.filter({ hasText: "第2話" }).locator("[data-unposted]")).toHaveText("未投稿：カクヨム");
  await expect(rows.filter({ hasText: "第1話" }).locator("[data-unposted]")).toHaveCount(0);
  await expect(rows.filter({ hasText: "第4話" }).locator("[data-unposted]")).toHaveCount(0);
  expect(await readFakeFile(page, LEDGER)).toBe(ledger);
});

test("投稿先を登録していない作品には、未投稿の印を出さない", async ({ page }) => {
  await openWithWorks(page, "#/works", FAKE_WORKS);
  await expect(page.locator(".work-card", { hasText: "灯台守の手紙_確認用" })).toBeVisible();
  await page.locator(".work-card", { hasText: "灯台守の手紙_確認用" }).click();
  await expect(page.locator(".ep-list .ep").first()).toBeVisible();
  await expect(page.locator("[data-unposted],[data-unposted-flag]")).toHaveCount(0);
});
