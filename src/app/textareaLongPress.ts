import { charFromPoint, readCharBoxes } from "./tapCaret";
import { LONG_PRESS_MS, MOVE_TOLERANCE_PX, wordAround } from "./rangeGestures";

/**
 * **左の線（既定の textarea）の長押しで、押した字を含む語を選ぶ**（iOS の手当て）。
 *
 * 2026-11-19 Mac の iPad mini 実機とシミュレーター（0.1.116・0.1.117）：縦書きの textarea で字を長押ししても、
 * iOS は何もしない（範囲も編集メニューも出ず、カーソルも動かない）。そのまま ⌫ を押すと、カーソルのある文の末の字が
 * 消えた。短く1回押す（カーソルが動く）・2度押し（語が選ばれる）は iOS のままで効くので、長押しだけをこちらで足す。
 *
 * - 押した字は、textarea と同じ見た目の写し（字ごとの span）をその場に作って読む（textarea の中の字の四隅は読めない）。
 *   読んだらすぐ消す
 * - 語の切れ目は右の線の欄と同じ（`wordAround`）。時間と動いてよい幅も同じ（{@link LONG_PRESS_MS}・{@link MOVE_TOLERANCE_PX}）
 * - 変換中は触らない。押したまま動いたら（欄を送っている）長押しにしない
 * - 指を離したときにもう一度選び直して焦点を当てる（iOS は人の操作のうちでないとキーボードを出さない）
 */
export function watchTextareaLongPress(area: HTMLTextAreaElement): () => void {
  let timer: number | undefined;
  let pressAt: { x: number; y: number } | undefined;
  let pressedAtTime = 0;
  let chosen: { start: number; end: number } | undefined;
  let composing = false;

  const choose = () => {
    if (composing || !pressAt) return;
    const at = textareaCharAt(area, pressAt.x, pressAt.y);
    if (at === undefined) return;
    const word = wordAround(area.value, at);
    if (word.start === word.end) return;
    chosen = word;
    area.setSelectionRange(word.start, word.end);
  };
  const cancel = () => {
    window.clearTimeout(timer);
    timer = undefined;
  };
  const onDown = (e: PointerEvent) => {
    chosen = undefined;
    if (composing || e.button > 0) return;
    pressAt = { x: e.clientX, y: e.clientY };
    pressedAtTime = e.timeStamp;
    cancel();
    timer = window.setTimeout(() => {
      timer = undefined;
      choose();
    }, LONG_PRESS_MS);
  };
  const onMove = (e: PointerEvent) => {
    if (timer === undefined || !pressAt) return;
    if (Math.hypot(e.clientX - pressAt.x, e.clientY - pressAt.y) > MOVE_TOLERANCE_PX) cancel();
  };
  const onUp = (e: PointerEvent) => {
    // 時計が遅れていても、押していた長さが足りていれば選ぶ（右の線の欄と同じ）
    if (timer !== undefined && e.timeStamp - pressedAtTime >= LONG_PRESS_MS) {
      cancel();
      choose();
    }
    cancel();
    if (!chosen) return;
    const { start, end } = chosen;
    area.focus();
    area.setSelectionRange(start, end);
    // 離したあとに端末がカーソルを置き直すことがあるので、次の描きの前にもう一度
    requestAnimationFrame(() => {
      if (chosen && document.activeElement === area) area.setSelectionRange(start, end);
      chosen = undefined;
    });
  };
  const onCompStart = () => {
    composing = true;
    cancel();
  };
  const onCompEnd = () => {
    composing = false;
  };
  area.addEventListener("pointerdown", onDown);
  area.addEventListener("pointermove", onMove);
  area.addEventListener("pointerup", onUp);
  area.addEventListener("pointercancel", cancel);
  area.addEventListener("compositionstart", onCompStart);
  area.addEventListener("compositionend", onCompEnd);
  return () => {
    cancel();
    area.removeEventListener("pointerdown", onDown);
    area.removeEventListener("pointermove", onMove);
    area.removeEventListener("pointerup", onUp);
    area.removeEventListener("pointercancel", cancel);
    area.removeEventListener("compositionstart", onCompStart);
    area.removeEventListener("compositionend", onCompEnd);
  };
}

/**
 * textarea と同じ見た目の写しを、textarea の上にぴったり重ねて作る（見えない・押せない）。中身は呼ぶ側が入れ、
 * 入れたあとで {@link syncMirrorScroll} を呼ぶ。使い終わったらすぐ消す（textarea の中の字の四隅は読めないため）
 */
export function mountMirror(area: HTMLTextAreaElement): HTMLDivElement {
  const mirror = document.createElement("div");
  const style = getComputedStyle(area);
  for (const name of Array.from(style)) mirror.style.setProperty(name, style.getPropertyValue(name));
  const r = area.getBoundingClientRect();
  Object.assign(mirror.style, {
    position: "fixed",
    left: `${r.left}px`,
    top: `${r.top}px`,
    margin: "0",
    visibility: "hidden",
    pointerEvents: "none",
    overflow: "hidden",
    whiteSpace: "pre-wrap",
  });
  document.body.appendChild(mirror);
  return mirror;
}

export function syncMirrorScroll(mirror: HTMLElement, area: HTMLTextAreaElement): void {
  mirror.scrollTop = area.scrollTop;
  mirror.scrollLeft = area.scrollLeft;
}

/** textarea の中で、画面の点 (x, y) の下にある字の位置。字の無い所なら undefined */
export function textareaCharAt(area: HTMLTextAreaElement, x: number, y: number): number | undefined {
  const mirror = mountMirror(area);
  const fragment = document.createDocumentFragment();
  let i = 0;
  for (const ch of area.value) {
    const span = document.createElement("span");
    span.dataset.i = String(i);
    span.dataset.n = String(ch.length);
    span.textContent = ch;
    fragment.appendChild(span);
    i += ch.length;
  }
  mirror.appendChild(fragment);
  syncMirrorScroll(mirror, area);
  const at = charFromPoint(readCharBoxes(mirror), x, y);
  mirror.remove();
  return at;
}

/** iOS の textarea の手当て（長押しで語を選ぶ・カーソルの印をこちらで描く）を使うか：iOS だけ（Android は端末のままで効く）。
 * パソコンの試しは localStorage の印 `novelai.test.iosTextarea` で */
export const IOS_TEXTAREA_TEST_KEY = "novelai.test.iosTextarea";
export function wantsIosTextareaFixes(platform: string, storage: Pick<Storage, "getItem"> | undefined): boolean {
  if (platform === "ios") return true;
  try {
    return storage?.getItem(IOS_TEXTAREA_TEST_KEY) === "1";
  } catch {
    return false;
  }
}
