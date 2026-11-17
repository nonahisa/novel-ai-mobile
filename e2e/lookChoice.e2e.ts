import { expect, test } from "@playwright/test";
import { openWithWorks } from "./support/fakeWorks";

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

  for (const look of ["standard", "washi", "hakuai", "sumishu"]) {
    test(`${look}：話の一覧の小さい添え書き（4話・22字）も、地と読み分けられる濃さ（4.5 対 1 以上）`, async ({ page }) => {
      await openWithWorks(page, "#/works");
      await page.evaluate((id) => localStorage.setItem("novelai.look", id), look);
      await page.reload();
      await page.locator(".work-card", { hasText: "灯台守の手紙_確認用" }).click();
      await expect(page.locator(".ep-list .ep").first()).toBeVisible();
      const ratio = await page.evaluate(() => {
        // 半ば透ける地は「color(srgb 0.95 0.95 0.97 / 0.88)」の形（0〜1）で返る
        const rgb = (text: string) => text.match(/[\d.]+/g)!.slice(0, 3).map((v) => (text.startsWith("color(") ? Number(v) * 255 : Number(v)));
        const lum = (c: number[]) => {
          const [r, g, b] = c.map((v) => {
            const x = v / 255;
            return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
          });
          return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
        };
        const small = document.querySelector(".appbar-title small")!;
        let el: Element | null = small;
        let bg = "rgba(0, 0, 0, 0)";
        while (el && /rgba\(0, 0, 0, 0\)|transparent/.test(bg)) {
          bg = getComputedStyle(el).backgroundColor;
          el = el.parentElement;
        }
        const a = lum(rgb(getComputedStyle(small).color));
        const b = lum(rgb(bg));
        return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      });
      expect(ratio).toBeGreaterThanOrEqual(4.5);
    });
  }
});

