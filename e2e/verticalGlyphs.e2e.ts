import { expect, test } from "@playwright/test";
import { openWithWorks } from "./support/fakeWorks";

/**
 * **縦書きの字の向き**（引継ぎ書 77章）。本体の原稿エディターと同じ `text-orientation: mixed`：
 * 半角の英数字・記号は横に寝かせ、全角の括弧は縦の形で出す。2026-11-16 AQUOS の試し2で、縦書き・横書きの試しの
 * C に打った半角の「(」が横書きの向きのまま立っていた（試しだけ upright だった）
 */

test.describe("縦書きの字の向き", () => {
  test("縦書き・横書きの試し（A・C）と動作確認ページの縦書きの欄は、原稿エディターと同じ mixed", async ({ page }) => {
    await openWithWorks(page, "#/tategaki");
    const orientation = (selector: string) => page.locator(selector).evaluate((el) => getComputedStyle(el).textOrientation);
    expect(await orientation("#draftInput")).toBe("mixed");
    await page.locator('[data-mode="C"]').click();
    await expect(page.locator("#draftComposed")).toBeVisible();
    expect(await orientation("#draftComposed")).toBe("mixed");
    await page.evaluate(() => (location.hash = "#/check"));
    expect(await orientation("#tategaki")).toBe("mixed");
  });
});
