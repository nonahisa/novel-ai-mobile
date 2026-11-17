import { expect, test } from "@playwright/test";
import { openWithWorks } from "./support/fakeWorks";

/**
 * **［書く］のタブの、最後に開いた話**（`src/app/lastEpisode.ts`。設計書 4.3）。作品は作り物（`_確認用`）だけ
 */

test.describe("［書く］の最後に開いた話", () => {
  test("話を開いたあと［書く］の頭に札が出て、押すとその話を開く", async ({ page }) => {
    await openWithWorks(page, "#/write");
    await expect(page.locator(".last-episode")).toHaveCount(0);
    await page.goto("/#/works");
    await page.locator(".work-card", { hasText: "灯台守の手紙_確認用" }).click();
    await page.locator(".ep-list .ep").first().click();
    await expect(page.locator("#msEditor")).toBeVisible();
    await page.locator(".appbar-back").click();
    await page.locator('#tabbar [data-tab="write"]').click();
    const card = page.locator(".last-episode .work-card");
    await expect(card).toContainText("第1話 手紙");
    await expect(card).toContainText("灯台守_確認用");
    await card.click();
    await expect(page.locator(".appbar-title")).toContainText("第1話 手紙");
    await expect(page.locator("#msEditor")).toBeVisible();
  });

  test("覚えていた場所が作品の外を指していたら札を出さない", async ({ page }) => {
    await openWithWorks(page, "#/works");
    await page.evaluate(() => localStorage.setItem("novelai.lastEpisode", JSON.stringify({ root: "灯台守_確認用", path: "灯台守_確認用/.aiwriter/a.txt" })));
    await page.goto("/#/write");
    await expect(page.locator(".appbar")).toContainText("書く");
    await expect(page.locator(".last-episode")).toHaveCount(0);
  });

  test("最後に開いた話の下に、最近開いた話が新しい順に並ぶ（2026-11-18 作者「最近開いた話を5つほど」）", async ({ page }) => {
    await openWithWorks(page, "#/works");
    await page.locator(".work-card", { hasText: "灯台守の手紙_確認用" }).click();
    for (const n of [0, 2, 1]) {
      await page.locator(".ep-list .ep").nth(n).click();
      await expect(page.locator("#msEditor")).toBeVisible();
      await page.locator(".appbar-back").click();
      await expect(page.locator(".ep-list .ep").first()).toBeVisible();
    }
    await page.locator('#tabbar [data-tab="write"]').click();
    await expect(page.locator(".last-episode .work-card")).toContainText("第2話");
    const recent = page.locator(".recent-episodes .ep");
    await expect(recent.locator(".name")).toHaveText(["第3話 霧笛", "第1話 手紙"]);
    await recent.first().click();
    await expect(page.locator(".appbar-title")).toContainText("第3話 霧笛");
  });
});
