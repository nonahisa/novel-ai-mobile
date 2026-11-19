import { expect, test } from "@playwright/test";
import { FAKE_WORKS, openWithWorks } from "./support/fakeWorks";

/**
 * **左の線（既定の textarea）の長押しで語を選ぶ**（iOS の手当て）。
 * 2026-11-19 Mac の iPad mini 実機と シミュレーター（0.1.116・0.1.117）：縦書きの textarea で「紙」を長押ししても、
 * iOS は何もせず（範囲も編集メニューも出ない）、カーソルは文の末のまま。そのまま ⌫ で末の「猫」が消えた。
 * 短く1回押す・2度押しは iOS のままで効く。長押しだけ、こちらで押した字を含む語を選ぶ（右の線の欄と同じ語の切れ目）。
 * iOS でだけ動かす。パソコンの Chromium では、試しの印（localStorage）を立てて同じ動きを見る。作品は作り物（`_確認用`）だけ
 */

test("長押しで、押した字を含む語が選ばれ、⌫ でその語だけが消える", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("novelai.test.iosTextarea", "1"));
  await openWithWorks(page, "#/works", FAKE_WORKS);
  await page.locator(".work-card", { hasText: "灯台守の手紙_確認用" }).click();
  await page.locator(".ep-list .ep").first().click();
  const editor = page.locator("#msEditor");
  await expect(editor).toBeVisible();
  // 先にカーソルを文の末へ（実機の B3 と同じ始まり）
  await editor.click();
  await editor.evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(el.value.length, el.value.length));

  // 「紙」（4字目）の真ん中を、textarea の字と同じ並びの写しで探して長押し
  const at = await editor.evaluate((el: HTMLTextAreaElement) => {
    const mirror = document.createElement("div");
    const style = getComputedStyle(el);
    for (const name of Array.from(style)) mirror.style.setProperty(name, style.getPropertyValue(name));
    const r = el.getBoundingClientRect();
    Object.assign(mirror.style, { position: "fixed", left: `${r.left}px`, top: `${r.top}px`, visibility: "hidden", overflow: "hidden", whiteSpace: "pre-wrap" });
    const span = document.createElement("span");
    mirror.append(el.value.slice(0, 4), span, el.value.slice(5));
    span.textContent = el.value[4];
    document.body.appendChild(mirror);
    mirror.scrollTop = el.scrollTop;
    mirror.scrollLeft = el.scrollLeft;
    const box = span.getBoundingClientRect();
    mirror.remove();
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  });
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.waitForTimeout(700);
  await page.mouse.up();
  await expect.poll(() => editor.evaluate((el: HTMLTextAreaElement) => [el.selectionStart, el.selectionEnd])).toEqual([3, 5]);
  await expect(editor).toBeFocused();
  await page.keyboard.press("Backspace");
  await expect(editor).toHaveValue("姉からが届いた。\n// 付箋：ここは後で直す\n");
});

/**
 * **カーソルの印をこちらで描く**（2026-11-19 iPad mini 実機：字は正しい所に入るのに、iPad が描くカーソルの線が1〜2字下に出た）。
 * 印が、textarea のカーソルの位置（その字の頭）に出て、動かすとついてくる。端末の印は透明にする
 */
test("カーソルの印をこちらで描き、カーソルの位置の字の頭に出る。範囲を選ぶと消える", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("novelai.test.iosTextarea", "1"));
  await openWithWorks(page, "#/works", FAKE_WORKS);
  await page.locator(".work-card", { hasText: "灯台守の手紙_確認用" }).click();
  await page.locator(".ep-list .ep").first().click();
  const editor = page.locator("#msEditor");
  await editor.click();
  const caret = page.locator(".textarea-caret");
  /** その位置の字の頭（縦書きは字の上の辺の真ん中）を、写しで読む */
  const headOf = (at: number) =>
    editor.evaluate((el: HTMLTextAreaElement, i) => {
      const mirror = document.createElement("div");
      const style = getComputedStyle(el);
      for (const name of Array.from(style)) mirror.style.setProperty(name, style.getPropertyValue(name));
      const r = el.getBoundingClientRect();
      Object.assign(mirror.style, { position: "fixed", left: `${r.left}px`, top: `${r.top}px`, margin: "0", visibility: "hidden", overflow: "hidden", whiteSpace: "pre-wrap" });
      const span = document.createElement("span");
      span.textContent = el.value[i];
      mirror.append(el.value.slice(0, i), span, el.value.slice(i + 1));
      document.body.appendChild(mirror);
      const b = span.getBoundingClientRect();
      mirror.remove();
      return { x: b.x + b.width / 2, y: b.y };
    }, at);
  const caretPoint = async () => {
    const b = (await caret.boundingBox())!;
    return { x: b.x + b.width / 2, y: b.y };
  };
  for (const at of [4, 12]) {
    await editor.evaluate((el: HTMLTextAreaElement, i) => el.setSelectionRange(i, i), at);
    await expect(caret).toBeVisible();
    const want = await headOf(at);
    await expect.poll(async () => {
      const got = await caretPoint();
      return Math.abs(got.x - want.x) < 3 && Math.abs(got.y - want.y) < 3;
    }).toBe(true);
  }
  await expect(editor).toHaveClass(/own-caret-shown/);
  // 打つとついてくる（「あ」を入れたあと、カーソルは「が」〈13字目〉の頭）
  await page.keyboard.type("あ");
  const want = await headOf(13);
  await expect.poll(async () => {
    const got = await caretPoint();
    return Math.abs(got.x - want.x) < 3 && Math.abs(got.y - want.y) < 3;
  }).toBe(true);
  // 範囲を選ぶと印は消え、端末の選びの色に任せる
  await editor.evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(3, 5));
  await expect(caret).toBeHidden();
  await expect(editor).not.toHaveClass(/own-caret-shown/);
});

/**
 * **短く押した字のすぐ後ろへカーソルを置く**（2026-11-19 夜 作者の決定。iPad mini 実機 0.1.124：「手紙」の「紙」を押すと、
 * iOS が語の切れ目に寄せて「手」の前に入った。シミュレーターでは「紙」の直後だったので、実機でだけ出る）。
 * 字のどこを押しても、その字の後ろ。字の無い所は右の線の欄と同じ決まり（列の末など）。2度押しの語の選びは iOS のまま
 */
test("短く押すと、押した字のすぐ後ろにカーソルが入る（字の上半分を押しても）", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("novelai.test.iosTextarea", "1"));
  await openWithWorks(page, "#/works", FAKE_WORKS);
  await page.locator(".work-card", { hasText: "灯台守の手紙_確認用" }).click();
  await page.locator(".ep-list .ep").first().click();
  const editor = page.locator("#msEditor");
  await expect(editor).toBeVisible();
  /** その字の箱（写しで読む） */
  const boxOf = (i: number) =>
    editor.evaluate((el: HTMLTextAreaElement, at) => {
      const mirror = document.createElement("div");
      const style = getComputedStyle(el);
      for (const name of Array.from(style)) mirror.style.setProperty(name, style.getPropertyValue(name));
      const r = el.getBoundingClientRect();
      Object.assign(mirror.style, { position: "fixed", left: `${r.left}px`, top: `${r.top}px`, margin: "0", visibility: "hidden", overflow: "hidden", whiteSpace: "pre-wrap" });
      const span = document.createElement("span");
      span.textContent = el.value[at];
      mirror.append(el.value.slice(0, at), span, el.value.slice(at + 1));
      document.body.appendChild(mirror);
      mirror.scrollTop = el.scrollTop;
      mirror.scrollLeft = el.scrollLeft;
      const b = span.getBoundingClientRect();
      mirror.remove();
      return { x: b.x, y: b.y, w: b.width, h: b.height };
    }, i);
  const selection = () => editor.evaluate((el: HTMLTextAreaElement) => [el.selectionStart, el.selectionEnd]);

  // 「紙」（4字目）の上のほう（端末のままなら「紙」の前に入る所）
  const kami = await boxOf(4);
  await page.mouse.click(kami.x + kami.w / 2, kami.y + kami.h * 0.2);
  await expect.poll(selection).toEqual([5, 5]);
  await expect(editor).toBeFocused();

  // 「姉」（0字目）の下のほう → 「姉」の後ろ
  const ane = await boxOf(0);
  await page.mouse.click(ane.x + ane.w / 2, ane.y + ane.h * 0.8);
  await expect.poll(selection).toEqual([1, 1]);
  await page.keyboard.type("猫");
  await expect(editor).toHaveValue(/^姉猫から手紙/);
});
