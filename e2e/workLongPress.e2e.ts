import { expect, test, type Page } from "@playwright/test";
import { FAKE_WORKS, openWithWorks, readFakeFile } from "./support/fakeWorks";

/**
 * **作品の長押し**（設計書 4.4.1。2026-11-18 作者の答え）：題を変える（設定ファイルの workTitle。フォルダー名は変えない）・
 * 登録から外す（送っていないもの・GitHub と結んでいない作品は外さない）。作品は作り物（`_確認用`）だけ
 */
async function longPressWork(page: Page, title: string) {
  const box = (await page.locator(".work-card", { hasText: title }).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(700);
  await page.mouse.up();
}

test("作品を長押し → 題を変える：一覧の題と設定ファイルの workTitle が替わる。フォルダーと話はそのまま", async ({ page }) => {
  await openWithWorks(page, "#/works", FAKE_WORKS);
  await longPressWork(page, "灯台守の手紙_確認用");
  await page.locator(".dialog-choices button", { hasText: "題を変える" }).click();
  await expect(page.locator("#dialogInput")).toHaveValue("灯台守の手紙_確認用");
  await page.locator("#dialogInput").fill("霧笛の灯台_確認用");
  await page.locator('[data-answer="yes"]').click();
  await expect(page.locator(".work-card", { hasText: "霧笛の灯台_確認用" })).toBeVisible();
  const config = JSON.parse((await readFakeFile(page, "灯台守_確認用/.aiwriter/config.json"))!);
  expect(config.workTitle).toBe("霧笛の灯台_確認用");
  expect(await readFakeFile(page, "灯台守_確認用/本文/第1話 手紙.txt")).toBe(FAKE_WORKS["灯台守_確認用/本文/第1話 手紙.txt"]);
});

test("作品を長押し → 登録から外す：GitHub と結んでいない作品は外さず、訳を出す（フォルダーは残る）", async ({ page }) => {
  await openWithWorks(page, "#/works", FAKE_WORKS);
  await longPressWork(page, "灯台守の手紙_確認用");
  await page.locator(".dialog-choices button", { hasText: "登録から外す" }).click();
  await expect(page.locator(".dialog-message")).toContainText("GitHub と結んでいない");
  await page.locator(".dialog [data-answer]").first().click();
  await expect(page.locator(".work-card", { hasText: "灯台守の手紙_確認用" })).toBeVisible();
  expect(await readFakeFile(page, "灯台守_確認用/本文/第1話 手紙.txt")).toBeDefined();
});
