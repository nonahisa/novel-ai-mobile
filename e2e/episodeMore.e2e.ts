import { expect, test } from "@playwright/test";
import { FAKE_WORKS, openWithWorks, readFakeFile } from "./support/fakeWorks";

/** 原稿エディターの上のバーの［…］（設計書 4.4・4.4.2）：この話で AI を走らせる。離れる前に書きかけは保存する。作品は作り物（`_確認用`）だけ */
const PATH = "灯台守_確認用/本文/第1話 手紙.txt";

test("［…］→ 誤字脱字：書きかけを保存してから、この話の見積もりへ", async ({ page }) => {
  await openWithWorks(page, "#/works", FAKE_WORKS);
  await page.locator(".work-card", { hasText: "灯台守の手紙_確認用" }).click();
  await page.locator(".ep-list .ep").first().click();
  const editor = page.locator("textarea#msEditor");
  await editor.click();
  await editor.press("End");
  await page.keyboard.type("足した");
  await page.locator("#episodeMore").click();
  await expect(page.locator(".dialog-choices .dialog-list button")).toHaveText(["誤字脱字", "推敲", "あらすじ"]);
  await page.locator(".dialog-choices button", { hasText: "誤字脱字" }).click();
  await expect(page).toHaveURL(/#\/typo\//);
  await expect(page.locator(".estimate")).toContainText("第1話 手紙");
  expect(await readFakeFile(page, PATH)).toContain("足した");
});

test("［…］→ あらすじ：この話のあらすじの画面へ", async ({ page }) => {
  await openWithWorks(page, "#/works", FAKE_WORKS);
  await page.locator(".work-card", { hasText: "灯台守の手紙_確認用" }).click();
  await page.locator(".ep-list .ep").first().click();
  await page.locator("#episodeMore").click();
  await page.locator(".dialog-choices button", { hasText: "あらすじ" }).click();
  await expect(page).toHaveURL(/#\/synopsis\//);
});
