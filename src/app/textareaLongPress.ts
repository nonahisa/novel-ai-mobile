import { caretFromPoint, charFromPoint, readCharBoxes, type CharBox } from "./tapCaret";
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
 *
 * **短く押したときは、押した字のすぐ後ろへカーソルを置く**（2026-11-19 夜 作者の決定。iPad mini 実機 0.1.124：
 * 「手紙」の「紙」を押すと、iOS が語の切れ目に寄せて「手」の前に入った。シミュレーターでは「紙」の直後だった）。
 * 字のどこを押しても、その字の後ろ（改行の字なら改行の前）。字の無い所（列の下の先など）は右の線の欄と同じ決まり
 * （`caretFromPoint`）。近い所を続けて2度押したとき（語を選ぶ）は触らず、iOS のままにする。
 * 実機の iOS は2度押しでないと分かるまで待ってから置くので、こちらも2度押しの間が過ぎてから置き、そのあと端末が置き直したら戻す
 * （2026-11-20 iPad mini 実機 0.1.127：離した直後に置くと、遅れて語の切れ目へ置き直され〈T1〉、2度押しも効かなくなった〈T3〉）
 */
export function watchTextareaLongPress(area: HTMLTextAreaElement): () => void {
  let timer: number | undefined;
  let pressAt: { x: number; y: number } | undefined;
  let pressedAtTime = 0;
  let chosen: { start: number; end: number } | undefined;
  let composing = false;
  let moved = false;
  let lastTap: { at: number; x: number; y: number } | undefined;
  /** 短く押した所へ置くカーソル（端末が置き直したら、{@link TAP_GUARD_MS} のあいだ戻す） */
  let tapped: number | undefined;
  let tappedUntil = 0;
  let tapTimer: number | undefined;
  /** 押したときの本文（道具帯の［貼り付け］などで本文が変わったら、もう戻さない） */
  let tappedValue = "";
  const trace = (what: string) => traceTap(what, area);

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
    trace("down");
    chosen = undefined;
    forgetTap();
    if (composing || e.button > 0) return;
    pressAt = { x: e.clientX, y: e.clientY };
    pressedAtTime = e.timeStamp;
    moved = false;
    cancel();
    timer = window.setTimeout(() => {
      timer = undefined;
      choose();
    }, LONG_PRESS_MS);
  };
  const onMove = (e: PointerEvent) => {
    if (timer === undefined || !pressAt) return;
    if (Math.hypot(e.clientX - pressAt.x, e.clientY - pressAt.y) > MOVE_TOLERANCE_PX) {
      moved = true;
      cancel();
    }
  };
  const forgetTap = () => {
    window.clearTimeout(tapTimer);
    tapTimer = undefined;
    tapped = undefined;
  };
  /** 短く押した所へ置く（端末がもう同じ所に置いていれば触らない） */
  const applyTap = () => {
    if (tapped === undefined || composing) return;
    if (area.value !== tappedValue) return forgetTap();
    if (document.activeElement === area && area.selectionStart !== area.selectionEnd) return forgetTap();
    trace(`apply ${tapped}`);
    if (document.activeElement !== area) area.focus();
    if (area.selectionStart !== tapped || area.selectionEnd !== tapped) area.setSelectionRange(tapped, tapped);
  };
  /** 短く1回押した：押した字の後ろへ */
  const placeTap = (e: PointerEvent) => {
    if (!pressAt) return;
    // 2度押し：近い所を続けて押した（別の字を素早く押し直したのは2度押しにしない）
    const doubleTap =
      lastTap !== undefined && e.timeStamp - lastTap.at < DOUBLE_TAP_MS && Math.hypot(pressAt.x - lastTap.x, pressAt.y - lastTap.y) <= DOUBLE_TAP_PX;
    lastTap = doubleTap ? undefined : { at: e.timeStamp, x: pressAt.x, y: pressAt.y };
    if (doubleTap || composing) return;
    const at = textareaCaretAt(area, pressAt.x, pressAt.y);
    if (at === undefined) return;
    // 離した直後には触らない：iOS の実機は、2度押しでないと分かるまで待ってからカーソルを（語の切れ目へ）置く。
    // 先にこちらが置くと、2度押しの語の選びが効かなくなった（2026-11-20 iPad mini 実機 0.1.127 の T3）。
    // 2度押しの間が過ぎたら置き、そのあと少しのあいだ、端末が置き直したら（範囲でないカーソルなら）こちらへ戻す（T1）
    trace(`tap ${at}`);
    tapped = at;
    tappedValue = area.value;
    tappedUntil = performance.now() + TAP_GUARD_MS;
    window.clearTimeout(tapTimer);
    tapTimer = window.setTimeout(() => {
      tapTimer = undefined;
      applyTap();
    }, DOUBLE_TAP_MS);
  };
  /** 端末が置き直したカーソルを、押した字の後ろへ戻す。範囲が選ばれたら（2度押しの語など）そのままにする */
  const onSelectionChange = () => {
    trace("selectionchange");
    if (tapped === undefined) return;
    if (area.value !== tappedValue) return forgetTap();
    if (performance.now() > tappedUntil || document.activeElement !== area) {
      if (performance.now() > tappedUntil) forgetTap();
      return;
    }
    if (area.selectionStart !== area.selectionEnd) {
      forgetTap();
      return;
    }
    if (tapTimer !== undefined) return; // 2度押しの間のうちは待つ（端末の置いた所は、間が過ぎたら直す）
    if (area.selectionStart !== tapped) {
      trace(`restore ${tapped}`);
      area.setSelectionRange(tapped, tapped);
    }
  };
  const onUp = (e: PointerEvent) => {
    trace(`up moved=${moved} long=${timer === undefined}`);
    // 時計が遅れていても、押していた長さが足りていれば選ぶ（右の線の欄と同じ）
    if (timer !== undefined && e.timeStamp - pressedAtTime >= LONG_PRESS_MS) {
      cancel();
      choose();
    }
    const wasTap = timer !== undefined && !moved && e.button <= 0;
    cancel();
    if (!chosen) {
      if (wasTap) placeTap(e);
      return;
    }
    lastTap = undefined;
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
    forgetTap();
  };
  const onCompEnd = () => {
    composing = false;
  };
  area.addEventListener("pointerdown", onDown);
  area.addEventListener("pointermove", onMove);
  area.addEventListener("pointerup", onUp);
  const onPointerCancel = () => {
    trace("cancel");
    cancel();
  };
  area.addEventListener("pointercancel", onPointerCancel);
  area.addEventListener("compositionstart", onCompStart);
  area.addEventListener("compositionend", onCompEnd);
  // 打ち始めたら（字・矢印）もう戻さない。打つ前に間が過ぎていなければ、先に置く
  const onKey = () => {
    applyTap();
    forgetTap();
  };
  area.addEventListener("keydown", onKey);
  area.addEventListener("beforeinput", onKey);
  area.addEventListener("blur", forgetTap);
  document.addEventListener("selectionchange", onSelectionChange);
  // 欄の外を押したら（道具帯・帯など）もう戻さない
  const onDocDown = (e: PointerEvent) => {
    if (!area.contains(e.target as Node)) forgetTap();
  };
  document.addEventListener("pointerdown", onDocDown, true);
  return () => {
    document.removeEventListener("pointerdown", onDocDown, true);
    cancel();
    forgetTap();
    area.removeEventListener("keydown", onKey);
    area.removeEventListener("beforeinput", onKey);
    area.removeEventListener("blur", forgetTap);
    document.removeEventListener("selectionchange", onSelectionChange);
    area.removeEventListener("pointerdown", onDown);
    area.removeEventListener("pointermove", onMove);
    area.removeEventListener("pointerup", onUp);
    area.removeEventListener("pointercancel", onPointerCancel);
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

/** 2度押しとみなす間（これより早く続けて押したら、2度目は iOS のままにする） */
export const DOUBLE_TAP_MS = 350;
/**
 * 押しの道筋（実機で、端末とこちらのどちらがカーソルを置いたかを後から見るため）。直近 {@link TAP_TRACE_MAX} 件を
 * `window.__novelaiTapTrace` に残す（Mac の Safari の Web インスペクタで読む。本文は残さない。位置の数だけ）
 */
export const TAP_TRACE_MAX = 60;
function traceTap(what: string, area: HTMLTextAreaElement): void {
  traceTouch(`${what} sel=${area.selectionStart}-${area.selectionEnd} focus=${document.activeElement === area}`);
}
/** 押しの道筋に1行足す（原稿の画面の空いた所の押しもここへ。本文は入れない） */
export function traceTouch(line: string): void {
  const w = window as unknown as { __novelaiTapTrace?: string[] };
  const list = (w.__novelaiTapTrace ??= []);
  list.push(`${Math.round(performance.now())} ${line}`);
  if (list.length > TAP_TRACE_MAX) list.splice(0, list.length - TAP_TRACE_MAX);
}

/** 短く押したあと、端末が置き直したカーソルをこちらへ戻すあいだ（離してから） */
export const TAP_GUARD_MS = 1500;
/** 2度押しとみなす近さ（1度目の点から） */
export const DOUBLE_TAP_PX = 24;

/** textarea の中で、画面の点 (x, y) の下にある字の位置。字の無い所なら undefined */
export function textareaCharAt(area: HTMLTextAreaElement, x: number, y: number): number | undefined {
  return charFromPoint(textareaCharBoxes(area), x, y);
}

/**
 * 短く押した点に置くカーソルの位置。押した字があればその字の後ろ（改行の字なら改行の前）。
 * 字の無い所は右の線の欄と同じ決まり（`caretFromPoint`）
 */
export function textareaCaretAt(area: HTMLTextAreaElement, x: number, y: number): number | undefined {
  const boxes = textareaCharBoxes(area);
  return caretAfterPressedChar(boxes, x, y, getComputedStyle(area).writingMode.startsWith("vertical"));
}

/** {@link textareaCaretAt} の決め方（DOM に触らない。テストのため） */
export function caretAfterPressedChar(boxes: readonly CharBox[], x: number, y: number, vertical: boolean): number | undefined {
  const at = charFromPoint(boxes, x, y);
  if (at === undefined) return caretFromPoint(boxes, x, y, vertical);
  const box = boxes.find((b) => b.i === at);
  return box && !box.newline ? at + box.n : at;
}

/** textarea と同じ並びの写しで、字ごとの四隅を読む（読んだらすぐ消す） */
function textareaCharBoxes(area: HTMLTextAreaElement): CharBox[] {
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
  const boxes = readCharBoxes(mirror);
  mirror.remove();
  return boxes;
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
