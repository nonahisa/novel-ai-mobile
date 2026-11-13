import { expect, test, type Page } from "@playwright/test";

/**
 * **C（組んで書く）**：ルビ・傍点を振り仮名・圏点で組んだまま打つ欄（2026-11-13 作者の答え
 * 「まず縦書きの試しで、本体と同じ『塊』の形を試し、iPad と Android で打ってみる」）。
 * 本物の日本語入力は起こせないので、キーと insertText で見る。決まりは `src/app/composedText.ts`。
 */

async function openC(page: Page): Promise<void> {
  await page.goto("/#/tategaki");
  await expect(page.locator("#draftResult")).not.toBeEmpty();
  await page.locator('[data-mode="C"]').click();
  await expect(page.locator("#draftComposed")).toBeVisible();
}

/** A の欄の本文（見えない支えの字を除く） */
const aText = (page: Page) => page.locator("#draftInput").evaluate((el) => (el.textContent ?? "").split("​").join(""));

async function caretToEnd(page: Page): Promise<void> {
  const pane = page.locator("#draftComposed");
  await pane.click();
  await pane.evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
  });
}

test.describe("C 組んで書く", () => {
  test("ルビと傍点が振り仮名・圏点の塊で組まれ、中には打てない", async ({ page }) => {
    await openC(page);
    const pane = page.locator("#draftComposed");
    await expect(pane).toHaveCSS("writing-mode", "vertical-rl");
    await expect(page.locator('[data-mode="C"]')).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#modeNote")).toContainText("組んで書く");
    await expect(pane.locator(".chunk-ruby rt").first()).toHaveText("わがはい");
    await expect(pane.locator(".chunk-em .bouten").first()).toHaveText("頓と");
    await expect(pane.locator(".chunk").first()).toHaveAttribute("contenteditable", "false");
    await expect(pane.locator(".chunk").first()).toHaveAttribute("data-src", "{吾輩|わがはい}");
  });

  test("組んで記法へ戻した本文が、A の本文と1字も違わない（往復の安全弁）", async ({ page }) => {
    await page.goto("/#/tategaki");
    await expect(page.locator("#draftResult")).not.toBeEmpty();
    const before = await aText(page);
    await page.locator('[data-mode="C"]').click();
    await expect(page.locator("#draftComposed .chunk").first()).toBeVisible();
    await page.locator('[data-mode="A"]').click();
    expect(await aText(page)).toBe(before);
  });

  test("塊のあとに打て、改行も入る。記法を打ち終えると塊に組み直す", async ({ page }) => {
    await openC(page);
    const pane = page.locator("#draftComposed");
    const chunks = await pane.locator(".chunk").count();
    await caretToEnd(page);
    await page.keyboard.press("Enter");
    await page.keyboard.insertText("{猫|ねこ}がいる");
    await expect(pane.locator(".chunk")).toHaveCount(chunks + 1);
    await expect(pane.locator(".chunk-ruby rt").last()).toHaveText("ねこ");
    // 字はカーソルの所（塊のあと）に入る
    await page.keyboard.insertText("。");
    await page.locator('[data-mode="A"]').click();
    expect((await aText(page)).endsWith("\n{猫|ねこ}がいる。")).toBe(true);
  });

  test("スマホの幅でも、3つの形の切り替えが横にはみ出さない", async ({ page }) => {
    await openC(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  });
});
