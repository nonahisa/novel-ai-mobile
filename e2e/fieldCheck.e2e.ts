import { expect, test, type Page } from "@playwright/test";

/**
 * **実機確認リストのうち、機械で確かめられる所**（`docs/実機確認リスト.md`。2026-11-12 母艦経由の作者の指示
 * 「実機確認をできるだけ自動化する方法をルール化して適用してください」、決まりは引継ぎ書 35章）。
 *
 * 本物の日本語入力・実機を手に持つ操作は起こせないので、ここではキーと画面の大きさで起こせる所だけを見る。
 * 項目の行に、このファイルとテストの名前を書いてある。
 */

async function open(page: Page, hash: string): Promise<void> {
  await page.goto(`/${hash}`);
  await expect(page.locator(".appbar")).toBeVisible();
}

/** A の欄の本文（見えない支えの字を除く） */
async function paneText(page: Page): Promise<string> {
  return page.locator("#draftInput").evaluate((el) => (el.textContent ?? "").split("​").join(""));
}

/** A の欄の末尾にカーソルを置く */
async function caretToEnd(page: Page): Promise<void> {
  await page.locator("#draftInput").click();
  await page.locator("#draftInput").evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
  });
}

test.describe("0章：動作確認ページ（段階① パソコンのブラウザ）", () => {
  test("縦書きの原稿欄・ルビと傍点・ファイルの往復が動く", async ({ page }) => {
    await open(page, "#/check");
    await expect(page.locator("#tategaki")).toHaveCSS("writing-mode", "vertical-rl");
    // ルビは本体と同じ書き方（{漢字|かんじ}）で組まれ、読みが rt に入る
    await expect(page.locator("#rubyOut ruby rt").first()).toHaveText("わがはい");
    await expect(page.locator("#rubyOut")).toHaveCSS("writing-mode", "vertical-rl");
    // 保存して読み戻す（ブラウザでは Capacitor の Filesystem が IndexedDB に書く）
    await page.locator("#save").click();
    await expect(page.locator("#fileResult")).toContainText("✅", { timeout: 15_000 });
    await page.locator("#saveShared").click();
    await expect(page.locator("#sharedFileResult")).toContainText("✅", { timeout: 15_000 });
  });
});

test.describe("1章：縦書きの欄でキーを打つ（本物の日本語入力の代わりにキーで）", () => {
  test("改行・1字消す・範囲を選んで消すが、縦書きのまま効く", async ({ page }) => {
    await open(page, "#/tategaki");
    await expect(page.locator("#draftInput")).toHaveCSS("writing-mode", "vertical-rl");
    const before = await paneText(page);
    await caretToEnd(page);
    await page.keyboard.press("Enter");
    await page.keyboard.insertText("ねこ");
    await expect.poll(() => paneText(page)).toBe(`${before}\nねこ`);
    await page.keyboard.press("Backspace");
    await expect.poll(() => paneText(page)).toBe(`${before}\nね`);
    // 範囲を選んで消す（Shift＋上で2字。縦書きでは字に沿って動くのは上下の矢印）
    await page.keyboard.press("Shift+ArrowUp");
    await page.keyboard.press("Shift+ArrowUp");
    await page.keyboard.press("Backspace");
    await expect.poll(() => paneText(page)).toBe(before);
    // 縦書きのまま（打っても横書きへ替わらない）
    await expect(page.locator("#draftInput")).toHaveCSS("writing-mode", "vertical-rl");
    // 字数（上のバーの補い）も本文に合わせて変わる
    await expect(page.locator("#draftCount")).toContainText("字");
  });
});

test.describe("2章：画面の大きさが変わっても書きかけを保つ", () => {
  test("回転（縦長→横長→縦長）しても、本文とカーソルの位置が残る", async ({ page }, info) => {
    test.skip(info.project.name !== "phone-light", "スマホの幅で1回だけ見る");
    await open(page, "#/tategaki");
    await caretToEnd(page);
    await page.keyboard.insertText("書きかけ");
    const text = await paneText(page);
    const caret = () =>
      page.evaluate(() => {
        const sel = window.getSelection()!;
        const range = sel.getRangeAt(0).cloneRange();
        range.setStart(document.querySelector("#draftInput")!, 0);
        return range.toString().split("​").join("").length;
      });
    const at = await caret();
    for (const size of [
      { width: 800, height: 360 },
      { width: 360, height: 800 },
    ]) {
      await page.setViewportSize(size);
      await expect.poll(() => paneText(page)).toBe(text);
      expect(await caret()).toBe(at);
    }
  });

  test("キーボードの分だけ画面が低くなっても、本文が残り、横にはみ出さない", async ({ page }, info) => {
    test.skip(info.project.name !== "phone-light", "スマホの幅で1回だけ見る");
    await open(page, "#/tategaki");
    await caretToEnd(page);
    await page.keyboard.insertText("続き");
    const text = await paneText(page);
    await page.setViewportSize({ width: 360, height: 480 });
    await expect.poll(() => paneText(page)).toBe(text);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  });
});
