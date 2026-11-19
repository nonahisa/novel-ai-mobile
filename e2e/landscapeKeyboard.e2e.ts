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

/**
 * **画面の外（body）の空きを押しても閉じる**（2026-11-20 iPhone 17 シミュレーター 0.1.129 の T7：一覧の札の下・キーボードの上の
 * 空きを押しても閉じなかった。キーボードが出ていると、その空きが画面の要素の外〈body〉になる見込み）。
 * 画面の外のほかの物（問いの窓・知らせなど）を押したときは外さない
 */
test("画面の外の body の空きを押すと焦点が外れる。画面の外のほかの物では外さない", async ({ page }) => {
  await openFirst(page);
  const editor = page.locator("textarea#msEditor");
  await editor.click();
  await page.setViewportSize({ width: 780, height: 150 });
  await expect(editor).toHaveCSS("writing-mode", "horizontal-tb");
  const tapOn = (make: string) =>
    page.evaluate((kind) => {
      let el: Element = document.body;
      if (kind === "overlay") {
        el = document.createElement("div");
        el.className = "zz-overlay";
        document.body.appendChild(el);
      }
      const at = (type: string) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 9, pointerType: "touch", clientX: 300, clientY: 140, isPrimary: true }));
      at("pointerdown");
      at("pointerup");
      if (kind === "overlay") el.remove();
    }, make);
  await tapOn("overlay");
  await expect(editor).toBeFocused();
  await tapOn("body");
  await expect(editor).not.toBeFocused();
});

/** 試しで起こしたとき（iOS の起動の引数 `-novelaiTouchTrace`）だけ、押しの道筋を端末の記録の受け口へも送る */
test("試しの印があるときだけ、押しの道筋を端末の記録の受け口へ送る（本文は入れない）", async ({ page }) => {
  await page.addInitScript(() => {
    const got: string[] = [];
    (window as unknown as { __got: string[] }).__got = got;
    (window as unknown as { webkit: unknown }).webkit = { messageHandlers: { novelaiTouchTrace: { postMessage: (b: string) => got.push(b) } } };
  });
  await openFirst(page);
  const editor = page.locator("textarea#msEditor");
  await editor.click();
  const tapBody = () =>
    page.evaluate(() => {
      for (const type of ["pointerdown", "pointerup"]) document.body.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 3, clientX: 1, clientY: 1 }));
    });
  await tapBody();
  expect(await page.evaluate(() => (window as unknown as { __got: string[] }).__got.length)).toBe(0);
  await editor.click();
  await page.evaluate(() => ((window as unknown as { __novelaiTouchTraceOn: boolean }).__novelaiTouchTraceOn = true));
  await tapBody();
  const got = await page.evaluate(() => (window as unknown as { __got: string[] }).__got);
  expect(got.some((l) => l.includes("blank-down body blank=true"))).toBe(true);
  const text = await editor.inputValue();
  expect(got.some((l) => l.includes(text.slice(0, 4)))).toBe(false);
});

/**
 * **キーボードが出ているとき、一覧を指で送っても画面全体がずれない**（2026-11-20 iPhone 17 シミュレーター 0.1.130：
 * 横向きでキーボードが出ているとき一覧を送ると、画面全体が上へずれ、上のバーの下に話の札と本文の上の行が潜り込んだ）。
 * 一覧が短くて送れないとき、指の動き（touchmove）をページへ渡さない（見える所が低いあいだ＝`data-compact`。横の電話は
 * キーボードが無くても低いので止まるが、そのときページは画面に収まっていて送る物が無い）
 */
test.describe("一覧の指の動き", () => {
  test.use({ hasTouch: true });
  test("見える所が低いあいだは、送れない一覧の指の動きをページへ渡さない", async ({ page }) => {
    await openFirst(page);
    const editor = page.locator("textarea#msEditor");
    await editor.click();
    /** 一覧の上で指を `dy` 動かし、その動きが止められたか（一覧は頭にある） */
    const swipeOnSide = (dy: number) =>
      page.locator("#msSide").evaluate((side, d) => {
        side.scrollTop = 0;
        const r = side.getBoundingClientRect();
        const touch = (y: number) => new Touch({ identifier: 1, target: side, clientX: r.x + 20, clientY: y });
        side.dispatchEvent(new TouchEvent("touchstart", { bubbles: true, cancelable: true, touches: [touch(r.y + 40)] }));
        const move = new TouchEvent("touchmove", { bubbles: true, cancelable: true, touches: [touch(r.y + 40 + d)] });
        side.dispatchEvent(move);
        return move.defaultPrevented;
      }, dy);
    await page.setViewportSize({ width: 780, height: 150 });
    await expect(page.locator("html")).toHaveAttribute("data-compact", "on");
    // 頭にある一覧で指を下へ（それ以上戻れない）：ページへ渡さない
    expect(await swipeOnSide(30)).toBe(true);
    // 指を上へ（一覧が送れる）なら止めない
    const scrolls = await page.locator("#msSide").evaluate((el) => el.scrollHeight > el.clientHeight + 1);
    expect(await swipeOnSide(-30)).toBe(!scrolls);
  });
});
