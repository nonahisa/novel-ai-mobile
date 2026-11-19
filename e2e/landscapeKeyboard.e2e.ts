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
 * iOS は、焦点の取れない所を押しても焦点を外さず、押せる物に見えない所では click も送らないことがある（0.1.128 の
 * シミュレーターで click で見る作りが効かなかった）。ここでは焦点の動かない押し（pointerdown・pointerup だけ。click は送らない）でまねる
 */
test("空いた所を押すと欄の焦点が外れ（キーボードが閉じ）、縦書きへ戻る。ボタンや欄の中を押したとき・送ったときは外さない", async ({ page }) => {
  await openFirst(page);
  const editor = page.locator("textarea#msEditor");
  await editor.click();
  await page.setViewportSize({ width: 780, height: 150 });
  await expect(editor).toHaveCSS("writing-mode", "horizontal-tb");
  /** 焦点を動かさずに押して離す（iOS の空いた所の押しと同じ。click は来ない）。`dy` だけ動かして離す */
  const tapWithoutFocus = (selector: string, dy = 0) =>
    page
      .locator(selector)
      .first()
      .evaluate((el, move) => {
        const r = el.getBoundingClientRect();
        const x = r.x + Math.min(10, r.width / 2);
        const y = r.y + Math.min(10, r.height / 2);
        const at = (type: string, yy: number) =>
          el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 7, pointerType: "touch", clientX: x, clientY: yy, isPrimary: true }));
        at("pointerdown", y);
        at("pointerup", y + move);
      }, dy);
  // 欄の中を押しても外さない
  await tapWithoutFocus("textarea#msEditor");
  await expect(editor).toBeFocused();
  // ボタン（道具帯のルビなど、欄に焦点があるまま使うもの）を押しても外さない
  await tapWithoutFocus(".ms-tools button");
  await expect(editor).toBeFocused();
  // 一覧を指で送った（押して動かして離した）だけなら外さない
  await tapWithoutFocus("#msSide", 40);
  await expect(editor).toBeFocused();
  // 一覧の空いた所（一覧の枠そのもの）を押すと外れる
  await tapWithoutFocus("#msSide");
  await expect(editor).not.toBeFocused();
  await expect(editor).toHaveCSS("writing-mode", "vertical-rl");
  // 押しの道筋に残る（実機で読む）
  expect(await page.evaluate(() => (window as unknown as { __novelaiTapTrace?: string[] }).__novelaiTapTrace?.some((l) => l.includes("blank-up moved=false")))).toBe(true);
});
