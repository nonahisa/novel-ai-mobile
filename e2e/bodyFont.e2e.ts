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

test("原稿の欄の上で2本指で広げると字が大きくなり、開き直しても覚えている（設計書 5.2）", async ({ page }) => {
  await openWithWorks(page, "#/works", FAKE_WORKS);
  await page.locator(".work-card", { hasText: "灯台守の手紙_確認用" }).click();
  await page.locator(".ep-list .ep").first().click();
  const editor = page.locator("#msEditor");
  await expect(editor).toBeVisible();
  const pinch = (distances: number[], fingers = 2) =>
    page.locator("#msHost").evaluate(
      (host, [list, count]) => {
        const box = host.getBoundingClientRect();
        const cx = box.left + box.width / 2;
        const cy = box.top + box.height / 2;
        const touches = (d: number) =>
          Array.from({ length: count as number }, (_, i) => new Touch({ identifier: i + 1, target: host, clientX: cx + (i === 0 ? -d / 2 : d / 2), clientY: cy }));
        const fire = (type: string, d: number, active = true) =>
          host.dispatchEvent(new TouchEvent(type, { bubbles: true, cancelable: true, touches: active ? touches(d) : [], changedTouches: touches(d) }));
        const ds = list as number[];
        fire("touchstart", ds[0]!);
        for (const d of ds.slice(1)) fire("touchmove", d);
        fire("touchend", ds[ds.length - 1]!, false);
      },
      [distances, fingers] as const
    );
  await pinch([100, 120, 150]);
  await expect.poll(() => editor.evaluate((el) => getComputedStyle(el).fontSize)).toBe("24px");
  expect(await page.evaluate(() => localStorage.getItem("novelai.bodySize"))).toBe("24");
  // 1本指の動きでは変えない
  await pinch([100, 200], 1);
  await expect.poll(() => editor.evaluate((el) => getComputedStyle(el).fontSize)).toBe("24px");
  await page.reload();
  await expect(page.locator("#msEditor")).toBeVisible();
  await expect.poll(() => page.locator("#msEditor").evaluate((el) => getComputedStyle(el).fontSize)).toBe("24px");
});
