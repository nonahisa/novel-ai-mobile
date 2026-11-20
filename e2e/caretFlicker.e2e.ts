import { expect, test, type Locator, type Page } from "@playwright/test";
import { FAKE_WORKS, openWithWorks } from "./support/fakeWorks";

/**
 * **iPad の左の線で、カーソルの印がちらつかない**（2026-11-20 朝 作者：「カーソルの表示がいろんな場所でちらつきます。
 * 例えば行がまだ生成されていない場所をタップした場合など」。iPad mini 実機 0.1.128。引継ぎ書 152章）。
 * iOS ではカーソルの印をこちらで描き（`textareaCaret.ts`）、短く押した所へこちらで置き直す（`textareaLongPress.ts`）。
 * - 押した直後に端末が置いた所へ印を描き、2度押しの間（350ms）が過ぎてこちらの所へ跳んでいた → 置くまで印を出さない
 * - 印を消すたびに端末の印の透明もやめていたので、範囲などの合間に iOS のずれた印が透けた → 焦点のあるあいだ透明のまま
 * - 動かしても点滅の調子が続き、消えている時に動くと見えなかった → 動かしたら点いた所から点滅し直す
 */

async function open(page: Page): Promise<Locator> {
  await page.addInitScript(() => {
    localStorage.setItem("novelai.test.iosTextarea", "1");
    // 印が見えた位置を、出るたびに残す
    const w = window as unknown as { __caretSeen: string[] };
    w.__caretSeen = [];
    new MutationObserver(() => {
      const c = document.querySelector<HTMLElement>(".textarea-caret");
      if (!c || c.hidden) return;
      const at = `${c.style.left},${c.style.top}`;
      if (w.__caretSeen[w.__caretSeen.length - 1] !== at) w.__caretSeen.push(at);
    }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ["style", "hidden"] });
  });
  await openWithWorks(page, "#/works", FAKE_WORKS);
  await page.locator(".work-card", { hasText: "灯台守の手紙_確認用" }).click();
  await page.locator(".ep-list .ep").first().click();
  const editor = page.locator("#msEditor");
  await expect(editor).toBeVisible();
  return editor;
}

const seen = (page: Page) => page.evaluate(() => (window as unknown as { __caretSeen: string[] }).__caretSeen.slice());
/** 記録をやり直す。押す前に出ていた印の位置を返す（押す前からそこにあったものは、跳んだ数に入れない） */
const resetSeen = (page: Page) =>
  page.evaluate(() => {
    (window as unknown as { __caretSeen: string[] }).__caretSeen = [];
    const c = document.querySelector<HTMLElement>(".textarea-caret");
    return c && !c.hidden ? `${c.style.left},${c.style.top}` : "";
  });

test("短く押すと、印はこちらが置いた所に1度だけ出て、跳ばない（字の上半分・行の無い所）", async ({ page }) => {
  const editor = await open(page);
  const kami = await charBox(editor, 4);
  const area = (await editor.boundingBox())!;
  // 字の上半分（端末は字の前、こちらは字の後ろ）と、本文の無い左の空き（縦書きの列がまだ無い所）
  for (const point of [
    { x: kami.x + kami.w / 2, y: kami.y + kami.h * 0.2 },
    { x: area.x + 30, y: area.y + area.height * 0.6 },
  ]) {
    const before = await resetSeen(page);
    await page.mouse.click(point.x, point.y);
    // 端末が遅れて別の所へ置き直す（実機の T1 と同じまね）
    await page.waitForTimeout(450);
    await editor.evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(0, 0));
    await page.waitForTimeout(400);
    const positions = (await seen(page)).filter((at, i) => !(i === 0 && at === before));
    expect(positions.length, `${before} | ${positions.join(" → ")}`).toBe(1);
  }
});

test("焦点のあるあいだ、端末の印は透明のまま（範囲を選んだときも）", async ({ page }) => {
  const editor = await open(page);
  await editor.click();
  await page.waitForTimeout(400);
  const transparent = () => editor.evaluate((el) => getComputedStyle(el).caretColor === "rgba(0, 0, 0, 0)");
  expect(await transparent()).toBe(true);
  await editor.evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(3, 5));
  await page.waitForTimeout(50);
  expect(await transparent()).toBe(true);
  await editor.evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(6, 6));
  await page.waitForTimeout(50);
  expect(await transparent()).toBe(true);
});

test("印を動かすと、点いた所から点滅し直す", async ({ page }) => {
  const editor = await open(page);
  await editor.click();
  // 押したあとの置き直しの見張り（1.5秒）が過ぎてから動かす
  await page.waitForTimeout(1700);
  await editor.evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(4, 4));
  const caret = page.locator(".textarea-caret");
  await expect(caret).toBeVisible();
  await page.waitForTimeout(700);
  await editor.evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(8, 8));
  // 描き直したあと、点滅は始めから（半分の 500ms までは点いている）
  await page.waitForTimeout(100);
  const phase = await page.evaluate(() => {
    const a = document.querySelector<HTMLElement>(".textarea-caret")!.getAnimations()[0];
    return Number(a?.currentTime ?? -1) % 1000;
  });
  expect(phase).toBeGreaterThanOrEqual(0);
  expect(phase).toBeLessThan(400);
});

/** その字の箱（textarea と同じ並びの写しで読む） */
function charBox(editor: Locator, i: number) {
  return editor.evaluate((el: HTMLTextAreaElement, at) => {
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
}
