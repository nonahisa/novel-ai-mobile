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

/** 最初の塊のすぐ後（after）・すぐ前（before）にカーソルを置く */
async function caretBesideFirstChunk(page: Page, side: "after" | "before"): Promise<void> {
  const pane = page.locator("#draftComposed");
  await pane.click();
  await pane.evaluate((el, where) => {
    const chunk = el.querySelector(".chunk")!;
    const range = document.createRange();
    if (where === "after") range.setStart(chunk.nextSibling!, 0);
    else range.setStart(chunk.previousSibling!, (chunk.previousSibling!.nodeValue ?? "").length);
    range.collapse(true);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
  }, side);
}

/** 最初の塊のすぐ後の地の字の from〜to 字目を選ぶ（見本では「は猫である。名前は…」） */
async function selectAfterFirstChunk(page: Page, from: number, to: number): Promise<void> {
  const pane = page.locator("#draftComposed");
  await pane.click();
  await pane.evaluate(
    (el, [a, b]) => {
      const node = el.querySelector(".chunk")!.nextSibling!;
      const range = document.createRange();
      range.setStart(node, a);
      range.setEnd(node, b);
      const sel = window.getSelection()!;
      sel.removeAllRanges();
      sel.addRange(range);
    },
    [from, to]
  );
}

test.describe("C 組んで書く", () => {
  test("ルビと傍点が振り仮名・圏点の塊で組まれ、中には打てない", async ({ page }) => {
    await openC(page);
    const pane = page.locator("#draftComposed");
    await expect(pane).toHaveCSS("writing-mode", "vertical-rl");
    await expect(page.locator('[data-mode="C"]')).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#modeNote")).toContainText("組んだまま");
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

  test("⌫ で、すぐ前の塊がまるごと消える（ほかの字は残る）", async ({ page }) => {
    await openC(page);
    const pane = page.locator("#draftComposed");
    const chunks = await pane.locator(".chunk").count();
    await caretBesideFirstChunk(page, "after");
    await page.keyboard.press("Backspace");
    await expect(pane.locator(".chunk")).toHaveCount(chunks - 1);
    await expect(page.locator("#imeLog")).toContainText("⌫ で塊を消した（{吾輩|わがはい}）");
    // 続けて打つと、消した所に入る
    await page.keyboard.insertText("我が輩");
    await page.locator('[data-mode="A"]').click();
    expect((await aText(page)).startsWith("我が輩は猫である。")).toBe(true);
  });

  test("Delete で、すぐ後の塊がまるごと消える", async ({ page }) => {
    await openC(page);
    const pane = page.locator("#draftComposed");
    const chunks = await pane.locator(".chunk").count();
    await caretBesideFirstChunk(page, "before");
    await page.keyboard.press("Delete");
    await expect(pane.locator(".chunk")).toHaveCount(chunks - 1);
    await page.locator('[data-mode="A"]').click();
    expect((await aText(page)).startsWith("は猫である。")).toBe(true);
  });

  test("塊のすぐ前に打てる（塊の中に入らない）", async ({ page }) => {
    await openC(page);
    await caretBesideFirstChunk(page, "before");
    await page.keyboard.insertText("「");
    await expect(page.locator("#imeLog")).toContainText("ルビ「吾輩」の直前");
    await page.locator('[data-mode="A"]').click();
    expect((await aText(page)).startsWith("「{吾輩|わがはい}は猫")).toBe(true);
  });

  test("押した所の様子を記録に残す（実機の確かめを記録で裏付ける）", async ({ page }) => {
    await openC(page);
    await page.locator("#draftComposed .chunk").first().click();
    await expect(page.locator("#imeLog")).toContainText("C 押した（点");
    // 塊を押しても、カーソルは塊の外
    await expect(page.locator("#imeLog")).not.toContainText("の中）");
  });

  test("［ルビ］：選んだ字に、窓で打った読みを振る", async ({ page }) => {
    await openC(page);
    const pane = page.locator("#draftComposed");
    const rubies = await pane.locator(".chunk-ruby").count();
    await expect(page.locator("#composedTools")).toBeVisible();
    await selectAfterFirstChunk(page, 1, 2); // 「猫」
    await page.locator("#composedRuby").click();
    await expect(page.locator(".dialog-message")).toHaveText("「猫」の読み");
    await page.locator("#dialogInput").fill("ねこ");
    await page.locator('.dialog [data-answer="yes"]').click();
    await expect(pane.locator(".chunk-ruby")).toHaveCount(rubies + 1);
    await expect(page.locator("#imeLog")).toContainText("ルビを振った（{猫|ねこ}）");
    await page.locator('[data-mode="A"]').click();
    expect((await aText(page)).startsWith("{吾輩|わがはい}は{猫|ねこ}である。")).toBe(true);
  });

  test("［ルビ］：すぐ前のルビの読みを直す・読みを消すと外す", async ({ page }) => {
    await openC(page);
    await caretBesideFirstChunk(page, "after");
    await page.locator("#composedRuby").click();
    await expect(page.locator("#dialogInput")).toHaveValue("わがはい");
    await page.locator("#dialogInput").fill("");
    await page.locator('.dialog [data-answer="yes"]').click();
    await expect(page.locator("#imeLog")).toContainText("ルビを外した（吾輩）");
    await page.locator('[data-mode="A"]').click();
    expect((await aText(page)).startsWith("吾輩は猫である。")).toBe(true);
  });

  test("［ルビ］：読みに | は使えない。［やめる］なら何も変えない", async ({ page }) => {
    await openC(page);
    await selectAfterFirstChunk(page, 1, 2);
    await page.locator("#composedRuby").click();
    await page.locator("#dialogInput").fill("ね|こ");
    await page.locator('.dialog [data-answer="yes"]').click();
    await expect(page.locator(".dialog-note")).toContainText("使えません");
    await page.locator('.dialog [data-answer="no"]').click();
    await expect(page.locator(".dialog")).toHaveCount(0);
    await page.locator('[data-mode="A"]').click();
    expect((await aText(page)).startsWith("{吾輩|わがはい}は猫である。")).toBe(true);
  });

  test("［ルビ］：振る字が無ければ訳を知らせる", async ({ page }) => {
    await openC(page);
    await caretBesideFirstChunk(page, "before");
    await page.locator("#composedRuby").click();
    await expect(page.locator("#composedNote")).toContainText("選んでから押してください");
    await expect(page.locator(".dialog")).toHaveCount(0);
  });

  test("［傍点］：選んだ字に付け、すぐ前の傍点を外す", async ({ page }) => {
    await openC(page);
    const pane = page.locator("#draftComposed");
    const ems = await pane.locator(".chunk-em").count();
    await selectAfterFirstChunk(page, 6, 8); // 「名前」
    await page.locator("#composedEm").click();
    await expect(pane.locator(".chunk-em")).toHaveCount(ems + 1);
    await expect(page.locator("#imeLog")).toContainText("傍点を付けた（{{名前}}）");
    // 付けたあとカーソルは塊のすぐ後。もう一度押すと外す
    await page.locator("#composedEm").click();
    await expect(pane.locator(".chunk-em")).toHaveCount(ems);
    await expect(page.locator("#imeLog")).toContainText("傍点を外した（名前）");
  });
});
