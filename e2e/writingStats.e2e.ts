import { expect, test } from "@playwright/test";
import { FAKE_WORKS, openWithWorks } from "./support/fakeWorks";

/**
 * **執筆統計（I）**（設計書 2章の I・3章「［ほか］→ 執筆統計。今日の字数だけは作品一覧の上にも小さく出す」）。
 * パソコンが書いた端末ごとの記録（`.aiwriter/stats/<端末>.json`）を足して見せるだけ。作品は作り物（`_確認用`）だけ
 */
function dayKey(at: Date): string {
  const shifted = new Date(at.getTime() - 4 * 3_600_000);
  return `${shifted.getFullYear()}-${String(shifted.getMonth() + 1).padStart(2, "0")}-${String(shifted.getDate()).padStart(2, "0")}`;
}
const today = dayKey(new Date());
const record = (deviceId: string, net: number) =>
  JSON.stringify({ schemaVersion: "1", deviceId, days: [{ date: today, net, gross: net, saves: 1 }] });

test("記録が無ければ作品一覧に字数を出さない", async ({ page }) => {
  await openWithWorks(page, "#/works", FAKE_WORKS);
  await expect(page.locator(".work-card").first()).toBeVisible();
  await expect(page.locator(".today-amount")).toHaveCount(0);
});

test("端末ごとの記録を足して、作品一覧の上に今日の字数。押すと執筆統計", async ({ page }) => {
  await openWithWorks(page, "#/works", {
    ...FAKE_WORKS,
    "灯台守_確認用/.aiwriter/stats/pc-home.json": record("pc-home", 300),
    "灯台守_確認用/.aiwriter/stats/pc-work.json": record("pc-work", 200),
    "雨の駅でいつまでも待ち続けている人と、その人を見送る駅員の長い長い物語_確認用/.aiwriter/stats/pc-home.json": record("pc-home", 60),
  });
  await expect(page.locator(".today-amount")).toHaveText("今日 +560字");
  await page.locator(".today-amount").click();
  await expect(page).toHaveURL(/#\/stats$/);
  await expect(page.locator(".stats-total")).toContainText("+560字");
  await expect(page.locator(".stats-works li", { hasText: "灯台守の手紙_確認用" })).toContainText("今日 +500字");
  await expect(page.locator(".stats-works li", { hasText: "壊れた設定_確認用" })).toContainText("記録なし");
  await expect(page.locator(".stats-note")).toContainText("この端末で書いた分は、まだ数えていません");
});

test("［ほか］→ 執筆統計 で開く", async ({ page }) => {
  await openWithWorks(page, "#/other", FAKE_WORKS);
  await page.getByRole("button", { name: "執筆統計" }).or(page.getByRole("link", { name: "執筆統計" })).first().click();
  await expect(page).toHaveURL(/#\/stats$/);
  await expect(page.locator(".stats-total")).toContainText("+0字");
});
