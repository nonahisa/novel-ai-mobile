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

test.describe("縦書きの試しの C の道具", () => {
  test("画面を送っても、取り消し・ルビ・傍点は上のバーのすぐ下に見えている（字を選んだまま押せる）", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 420 });
    await openWithWorks(page, "#/tategaki");
    await page.locator('[data-mode="C"]').click();
    await expect(page.locator("#composedTools")).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, 400));
    const bar = (await page.locator(".appbar").boundingBox())!;
    const tools = (await page.locator("#composedTools").boundingBox())!;
    expect(Math.round(tools.y)).toBe(Math.round(bar.y + bar.height));
    await expect(page.locator("#composedRuby")).toBeInViewport();
  });
});
