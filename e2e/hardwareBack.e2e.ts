import { expect, test, type Page } from "@playwright/test";
import { openWithWorks, readFakeFile } from "./support/fakeWorks";

/**
 * **端末の［戻る］キー**（`src/app/hardwareBack.ts`。設計書 4.3）。
 * 端末では Capacitor が document に "backbutton" を送る。ここではそれを直に送って、
 * 画面の中の［←］と同じ道を通るか（窓 → 上のバー → ［作品］→ 裏へ回す）を見る。作品は作り物（`_確認用`）だけ
 */

const EPISODE = "灯台守_確認用/本文/第1話 手紙.txt";

const pressBack = (page: Page) => page.evaluate(() => document.dispatchEvent(new Event("backbutton")));

test.describe("端末の［戻る］キー", () => {
  test("原稿エディター → 保存を済ませて話の一覧 → 作品一覧。作品一覧ではとどまる", async ({ page }) => {
    await openWithWorks(page, "#/works");
    await page.locator(".work-card", { hasText: "灯台守の手紙_確認用" }).click();
    await page.locator(".ep-list .ep").first().click();
    await page.locator("#msEditor").fill("戻るキーで戻る。\n");
    await pressBack(page);
    await expect(page).toHaveURL(/#\/work\//);
    expect(await readFakeFile(page, EPISODE)).toBe("戻るキーで戻る。\n");
    await pressBack(page);
    await expect(page).toHaveURL(/#\/works$/);
    await expect(page.locator(".work-card").first()).toBeVisible();
    await pressBack(page);
    await expect(page).toHaveURL(/#\/works$/);
  });

  test("［ほか］では［作品］へ。すべての機能では［ほか］へ", async ({ page }) => {
    await openWithWorks(page, "#/other");
    await pressBack(page);
    await expect(page).toHaveURL(/#\/works$/);
    await page.goto("/#/other");
    await page.goto("/#/all");
    await pressBack(page);
    await expect(page).toHaveURL(/#\/other$/);
  });

  test("窓が出ていれば、閉じる側（［閉じる］［とどまる］）を押す。捨てる側は押さない", async ({ page }) => {
    await openWithWorks(page, "#/works");
    await page.locator(".work-card", { hasText: "灯台守の手紙_確認用" }).click();
    await page.locator(".ep-list .ep").first().click();
    await expect(page.locator("#msEditor")).toBeVisible();
    // 同期で入れ替わったことにする（置き場の記録を直に書き換える）
    await page.evaluate(async (path) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("Disc", 1);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const store = db.transaction(["FileStorage"], "readwrite").objectStore("FileStorage");
      const full = `/DATA/works/${path}`;
      const record = await new Promise<Record<string, unknown>>((resolve) => {
        const get = store.get(full);
        get.onsuccess = () => resolve(get.result as Record<string, unknown>);
      });
      record.content = btoa(String.fromCharCode(...new TextEncoder().encode("外で入れ替わった。\n")));
      store.put(record);
      db.close();
    }, EPISODE);
    await page.locator("#msEditor").fill("こちらの書きかけ。\n");
    await expect(page.locator(".dialog-message")).toHaveText(/外で変わったので/, { timeout: 5000 });
    await pressBack(page);
    await expect(page.locator(".dialog-backdrop")).toHaveCount(0);
    await expect(page).toHaveURL(/#\/episode\//);
    // 戻ろうとすると訊く。［戻る］キーは［とどまる］
    await pressBack(page);
    await expect(page.locator(".dialog-message")).toContainText("書きかけは端末に残っています");
    await pressBack(page);
    await expect(page.locator(".dialog-backdrop")).toHaveCount(0);
    await expect(page).toHaveURL(/#\/episode\//);
    await expect(page.locator("#msEditor")).toHaveValue("こちらの書きかけ。\n");
  });
});
