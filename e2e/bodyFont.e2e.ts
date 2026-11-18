import { expect, test, type Page } from "@playwright/test";
import { FAKE_WORKS, openWithWorks } from "./support/fakeWorks";

/**
 * **本文の書体**（2026-11-18 作者の答え「案3 なろう寄り」：既定はゴシック・16px・行間1.8。［表示］で明朝と切り替える。
 * 見た目の案のどれでも同じに効く）。作品は作り物（`_確認用`）だけ
 */
async function editorFont(page: Page) {
  await page.evaluate(() => (location.hash = "#/works"));
  await page.locator(".work-card", { hasText: "灯台守の手紙_確認用" }).click();
  await page.locator(".ep-list .ep").first().click();
  const editor = page.locator("#msEditor");
  await expect(editor).toBeVisible();
  const font = await editor.evaluate((el) => {
    const style = getComputedStyle(el);
    return { family: style.fontFamily, size: style.fontSize, leading: style.lineHeight };
  });
  await page.locator(".appbar-back").click();
  await expect(page.locator("#msEditor")).toHaveCount(0);
  return font;
}

test("既定はゴシック・16px・行間1.8。［表示］で明朝にすると替わり、開き直しても覚えている", async ({ page }) => {
  await openWithWorks(page, "#/works", FAKE_WORKS);
  const first = await editorFont(page);
  expect(first.family).toContain("Hiragino Sans");
  expect(first.family).not.toContain("Mincho");
  expect(first.size).toBe("16px");
  expect(parseFloat(first.leading)).toBeCloseTo(16 * 1.8, 1);

  await page.evaluate(() => (location.hash = "#/display"));
  await expect(page.locator('#bodyFontSlot [data-body-font="gothic"]')).toHaveAttribute("aria-pressed", "true");
  await page.locator('#bodyFontSlot [data-body-font="mincho"]').click();
  await expect(page.locator("html")).toHaveAttribute("data-body-font", "mincho");
  const mincho = await editorFont(page);
  expect(mincho.family).toContain("Mincho");
  expect(mincho.size).toBe("16px");

  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-body-font", "mincho");
});

for (const look of ["standard", "washi", "hakuai", "sumishu"]) {
  test(`見た目「${look}」でも本文はゴシック・16px`, async ({ page }) => {
    await page.addInitScript((id) => localStorage.setItem("novelai.look", id), look);
    await openWithWorks(page, "#/works", FAKE_WORKS);
    const font = await editorFont(page);
    expect(font.family).toContain("Hiragino Sans");
    expect(font.size).toBe("16px");
  });
}
