import { expect, test } from "@playwright/test";
import { FAKE_WORKS, openWithWorks } from "./support/fakeWorks";

/**
 * **横向きの電話でキーボードが出たら自動で横書き、閉じると縦書きへ戻る**（2026-11-19 夜 作者の決定、案2）。
 * パソコンではキーボードを出せないので、窓の高さを縮めて出たことにする（Android は窓そのものが縮む）。
 * 作者の選び（縦・横）は書き換えない。作品は作り物（`_確認用`）だけ
 */
test.use({ viewport: { width: 780, height: 360 } });

async function openFirst(page: import("@playwright/test").Page): Promise<void> {
  // 本物の端末では、キーボードが出ても画面の大きさは変わらない。Playwright は窓を縮めると画面も縮めるので、画面を止めておく
  await page.addInitScript(() => {
    Object.defineProperty(screen, "width", { get: () => 780 });
    Object.defineProperty(screen, "height", { get: () => 360 });
  });
  await openWithWorks(page, "#/works", FAKE_WORKS);
  await page.locator(".work-card", { hasText: "灯台守の手紙_確認用" }).click();
  await page.locator("#msSide .ep, .ep-list .ep").first().click();
  await expect(page.locator("textarea#msEditor")).toBeVisible();
}

test("キーボードが出ると横書き、閉じると縦書きへ戻る。作者の選びは縦のまま", async ({ page }) => {
  await openFirst(page);
  const editor = page.locator("textarea#msEditor");
  await expect(editor).toHaveCSS("writing-mode", "vertical-rl");
  await editor.click();
  await page.setViewportSize({ width: 780, height: 150 });
  await expect(editor).toHaveCSS("writing-mode", "horizontal-tb");
  await expect(editor).toBeFocused();
  await expect(page.locator("#orientToggle")).toHaveText("横で書く");
  await page.keyboard.type("あ");
  await page.setViewportSize({ width: 780, height: 360 });
  await expect(editor).toHaveCSS("writing-mode", "vertical-rl");
  await expect(editor).toHaveValue(/あ/);
});

test("欄に焦点が無ければ（キーボードが欄のものでなければ）替えない", async ({ page }) => {
  await openFirst(page);
  await page.setViewportSize({ width: 780, height: 150 });
  await page.waitForTimeout(300);
  await expect(page.locator("textarea#msEditor")).toHaveCSS("writing-mode", "vertical-rl");
});

test("変換中は替えず、確定してから替える", async ({ page }) => {
  await openFirst(page);
  const editor = page.locator("textarea#msEditor");
  await editor.click();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.imeSetComposition", { text: "ねこ", selectionStart: 2, selectionEnd: 2 });
  await page.setViewportSize({ width: 780, height: 150 });
  await page.waitForTimeout(300);
  await expect(editor).toHaveCSS("writing-mode", "vertical-rl");
  await cdp.send("Input.insertText", { text: "猫" });
  await expect(editor).toHaveCSS("writing-mode", "horizontal-tb");
  await expect(editor).toHaveValue(/猫/);
});

/**
 * **一覧の側などの空いた所を押すと、キーボードが閉じる**（2026-11-20 iPhone 17 シミュレーターの T7：横向きの iPhone の
 * キーボードには閉じるキーが無く、一覧の側の空いた所を押しても閉じなかった。上のバーの題を押すと閉じた）。
 * iOS は、焦点の取れない所を押しても焦点を外さない（Chromium は外す）。ここでは焦点の動かない押し（click だけ）でまねる
 */
test("空いた所を押すと欄の焦点が外れ（キーボードが閉じ）、縦書きへ戻る。ボタンや欄の中を押したときは外さない", async ({ page }) => {
  await openFirst(page);
  const editor = page.locator("textarea#msEditor");
  await editor.click();
  await page.setViewportSize({ width: 780, height: 150 });
  await expect(editor).toHaveCSS("writing-mode", "horizontal-tb");
  /** 焦点を動かさずに押す（iOS の空いた所の押しと同じ） */
  const tapWithoutFocus = (selector: string) =>
    page.locator(selector).first().evaluate((el) => el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })));
  // 欄の中を押しても外さない
  await tapWithoutFocus("textarea#msEditor");
  await expect(editor).toBeFocused();
  // ボタン（道具帯のルビなど、欄に焦点があるまま使うもの）を押しても外さない
  await tapWithoutFocus(".ms-tools button");
  await expect(editor).toBeFocused();
  // 一覧の空いた所（一覧の枠そのもの）を押すと外れる
  await tapWithoutFocus("#msSide");
  await expect(editor).not.toBeFocused();
  await expect(editor).toHaveCSS("writing-mode", "vertical-rl");
});
