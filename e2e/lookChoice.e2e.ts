import { expect, test } from "@playwright/test";

/**
 * **見た目の案を選ぶ**（設定 → 表示 → 見た目。`src/app/look.ts`・`src/looks.css`。2026-11-18 作者「選べるようにしてください」）
 */
test.describe("見た目の案", () => {
  test("表示の画面で選ぶと、すぐに替わり、開き直しても覚えている。標準に戻せる", async ({ page }) => {
    await page.goto("/#/display");
    const choices = page.locator("[data-look-choice]");
    await expect(choices).toHaveText(["標準", "和紙と墨", "白と藍", "墨と朱"]);
    await expect(page.locator('[data-look-choice="standard"]')).toHaveAttribute("aria-pressed", "true");
    const paper = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    const before = await paper();

    await page.locator('[data-look-choice="washi"]').click();
    await expect(page.locator("html")).toHaveAttribute("data-look", "washi");
    await expect(page.locator('[data-look-choice="washi"]')).toHaveAttribute("aria-pressed", "true");
    expect(await paper()).not.toBe(before);

    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-look", "washi");

    await page.locator('[data-look-choice="standard"]').click();
    await expect(page.locator("html")).not.toHaveAttribute("data-look", /.+/);
    expect(await paper()).toBe(before);
  });

  for (const look of ["washi", "hakuai", "sumishu"]) {
    test(`${look}：一覧が横にはみ出さず、字と地の色が分かれている`, async ({ page }) => {
      await page.goto("/#/other");
      await page.evaluate((id) => localStorage.setItem("novelai.look", id), look);
      await page.reload();
      await expect(page.locator("html")).toHaveAttribute("data-look", look);
      const colors = await page.evaluate(() => {
        const item = document.querySelector(".menu-item")!;
        return { ink: getComputedStyle(item).color, bg: getComputedStyle(document.body).backgroundColor, wide: document.documentElement.scrollWidth - document.documentElement.clientWidth };
      });
      expect(colors.ink).not.toBe(colors.bg);
      expect(colors.wide).toBeLessThanOrEqual(0);
    });
  }
});
