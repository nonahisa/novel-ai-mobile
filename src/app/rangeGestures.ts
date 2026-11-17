import { caretFromPoint, charFromPoint, readCharBoxes, type CharBox } from "./tapCaret";

/**
 * **右の線の欄で、長押しとつまみで範囲を選ぶ**（2026-11-18 作者の答え D「iPad で確かめてから、右の欄で範囲を
 * 選べるようにする」の2つ目。1つ目の範囲の形は `editContextModel.ts` の `anchor`）。
 *
 * 字をこの画面が描くので、端末の選び（つまみ・編集メニュー）は出ない。そこで選びもこの画面が持つ：
 *
 * - **長押し**（{@link LONG_PRESS_MS}）で、押した字を含む語を選ぶ（語の切れ目は `Intl.Segmenter`。無い端末や
 *   記号・空白なら、その1字）。押したまま {@link MOVE_TOLERANCE_PX} より動いたら長押しにしない（欄を送っている）
 * - 範囲の両端に**つまみ**を出す。つまみは欄の外の層（`host` の中）に置き、`touch-action: none` で引く。
 *   欄は字を描き直すたびに中身を作り直すので、欄の中に置くと引いている途中で消える
 * - 字の中で押したまま引いて範囲をのばすのは作らない（欄が送られ、端末が指を引き取る `pointercancel`）
 * - 長押しのあとに来る click（マウス・試験）は飲み込む（欄の click はカーソルを置き直して範囲を外すため）
 * - 変換中は何もしない
 *
 * 記録（`log`）は Mac の試しで読む：押した・長押し・取り消し（知らせの種類）・つまみを掴んだ・引いた・離した・範囲
 */

export const LONG_PRESS_MS = 450;
export const MOVE_TOLERANCE_PX = 10;

export interface RangeTarget {
  /** 字を描く欄（`[data-i]` の span が並ぶ） */
  element: HTMLElement;
  /** つまみを置く層の親（欄を含む箱。`position: relative` にする） */
  host: HTMLElement;
  text(): string;
  selection(): { start: number; end: number };
  /** 範囲を選ぶ（`anchor` は動かない側の端） */
  select(anchor: number, focus: number): void;
  composing(): boolean;
  log(line: string): void;
}

/** 押した字を含む語（無ければその1字）。DOM に触らない（試験のため） */
export function wordAround(text: string, index: number): { start: number; end: number } {
  if (index < 0 || index >= text.length) return { start: index, end: index };
  const code = text.charCodeAt(index);
  const single = { start: index, end: index + (code >= 0xd800 && code <= 0xdbff && index + 1 < text.length ? 2 : 1) };
  if (text[index] === "\n") return { start: index, end: index };
  const lineStart = text.lastIndexOf("\n", index - 1) + 1;
  const next = text.indexOf("\n", index);
  const line = text.slice(lineStart, next < 0 ? text.length : next);
  const Segmenter = (Intl as unknown as { Segmenter?: new (locale: string, options: { granularity: "word" }) => { segment(s: string): Iterable<{ segment: string; index: number; isWordLike?: boolean }> } }).Segmenter;
  if (!Segmenter) return single;
  const at = index - lineStart;
  for (const part of new Segmenter("ja", { granularity: "word" }).segment(line)) {
    if (at >= part.index && at < part.index + part.segment.length) {
      return part.isWordLike ? { start: lineStart + part.index, end: lineStart + part.index + part.segment.length } : single;
    }
  }
  return single;
}

/** つまみの丸を、範囲の端の線からどれだけ離すか（丸が隣の字にかぶらないように、列の外へ出す） */
export const KNOB_GAP_PX = 9;

/**
 * つまみを置く点（丸の中心）と、端の線の長さ（列の幅）。丸は列の外に出し、隣の字にかぶせない：
 * 縦書きは、頭の丸を列の右（範囲の頭の字の上の端の高さ）、末の丸を列の左（末の字の下の端の高さ）。
 * 横書きは、頭の丸を行の上（頭の字の左の端）、末の丸を行の下（末の字の右の端）
 */
export function handlePoints(
  chars: readonly CharBox[],
  start: number,
  end: number,
  vertical: boolean
): { start?: { x: number; y: number; line: number }; end?: { x: number; y: number; line: number } } {
  const inside = chars.filter((c) => !c.newline && c.i >= start && c.i < end && (c.right > c.left || c.bottom > c.top));
  if (inside.length === 0) return {};
  const first = inside.reduce((a, b) => (b.i < a.i ? b : a));
  const last = inside.reduce((a, b) => (b.i > a.i ? b : a));
  return vertical
    ? {
        start: { x: first.right + KNOB_GAP_PX, y: first.top, line: first.right - first.left },
        end: { x: last.left - KNOB_GAP_PX, y: last.bottom, line: last.right - last.left },
      }
    : {
        start: { x: first.left, y: first.top - KNOB_GAP_PX, line: first.bottom - first.top },
        end: { x: last.right, y: last.bottom + KNOB_GAP_PX, line: last.bottom - last.top },
      };
}

export function mountRangeGestures(target: RangeTarget): () => void {
  const { element, host, log } = target;
  const vertical = () => element.classList.contains("vertical");
  host.classList.add("range-host");
  const layer = document.createElement("div");
  layer.className = "range-handles";
  layer.innerHTML = `<div class="range-handle" data-end="start" aria-hidden="true"><i></i></div><div class="range-handle" data-end="end" aria-hidden="true"><i></i></div>`;
  host.appendChild(layer);
  const handles = {
    start: layer.querySelector<HTMLElement>('[data-end="start"]')!,
    end: layer.querySelector<HTMLElement>('[data-end="end"]')!,
  };

  /** つまみを範囲の両端へ（範囲が無い・変換中・欄の見える所の外なら隠す） */
  const place = () => {
    const { start, end } = target.selection();
    const show = start !== end && !target.composing();
    if (!show) {
      handles.start.hidden = true;
      handles.end.hidden = true;
      return;
    }
    const points = handlePoints(readCharBoxes(element), start, end, vertical());
    const box = host.getBoundingClientRect();
    const seen = element.getBoundingClientRect();
    for (const side of ["start", "end"] as const) {
      const point = points[side];
      const handle = handles[side];
      // 丸は列の外へ出してあるので、欄の端から丸のずらし分までは見えているものとする
      const slack = KNOB_GAP_PX + 2;
      const visible = point && point.x >= seen.left - slack && point.x <= seen.right + slack && point.y >= seen.top - slack && point.y <= seen.bottom + slack;
      handle.hidden = !visible;
      if (!visible) continue;
      handle.style.left = `${point.x - box.left + host.scrollLeft}px`;
      handle.style.top = `${point.y - box.top + host.scrollTop}px`;
      handle.dataset.dir = vertical() ? "vertical" : "horizontal";
      handle.style.setProperty("--line", `${point.line}px`);
    }
  };
  let placing = 0;
  const placeSoon = () => {
    if (placing) return;
    placing = requestAnimationFrame(() => {
      placing = 0;
      place();
    });
  };
  // 欄は字を描き直すたびに中身を作り直す。そのたびにつまみを置き直す
  const watcher = new MutationObserver(placeSoon);
  watcher.observe(element, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
  element.addEventListener("scroll", placeSoon, { passive: true });
  window.addEventListener("resize", placeSoon);

  // ---------- 長押し ----------
  let pressTimer: number | undefined;
  let pressAt: { x: number; y: number } | undefined;
  let swallowClick = false;
  const cancelPress = (why: string) => {
    if (pressTimer === undefined) return;
    window.clearTimeout(pressTimer);
    pressTimer = undefined;
    log(`範囲：長押しをやめた（${why}）`);
  };
  const onPointerDown = (e: PointerEvent) => {
    swallowClick = false;
    if (target.composing() || e.button > 0) return;
    pressAt = { x: e.clientX, y: e.clientY };
    const boxes = readCharBoxes(element);
    const index = charFromPoint(boxes, e.clientX, e.clientY);
    log(`範囲：押した（${e.pointerType}・${index === undefined ? "字の無い所" : `${index}字目`}）`);
    window.clearTimeout(pressTimer);
    pressTimer = window.setTimeout(() => {
      pressTimer = undefined;
      if (target.composing() || !pressAt) return;
      // 押したあとで欄が送られていても、いまの字の場所で読む
      const at = charFromPoint(readCharBoxes(element), pressAt.x, pressAt.y);
      if (at === undefined) return log("範囲：長押しした所に字が無い");
      const word = wordAround(target.text(), at);
      if (word.start === word.end) return;
      target.select(word.start, word.end);
      swallowClick = true;
      log(`範囲：長押しで選んだ ${word.start}〜${word.end}字目`);
    }, LONG_PRESS_MS);
  };
  const onPointerMove = (e: PointerEvent) => {
    if (pressTimer === undefined || !pressAt) return;
    if (Math.hypot(e.clientX - pressAt.x, e.clientY - pressAt.y) > MOVE_TOLERANCE_PX) cancelPress("動いた");
  };
  const onPointerEnd = (e: PointerEvent) => cancelPress(e.type === "pointercancel" ? "取り消された（端末が引き取った）" : "離した");
  /** 長押しで選んだあとの click は、欄に届けない（届くとカーソルを置き直し、範囲が外れる） */
  const onClickCapture = (e: MouseEvent) => {
    if (!swallowClick) return;
    swallowClick = false;
    e.stopImmediatePropagation();
    e.preventDefault();
  };
  // Android は長押しで端末のメニュー（contextmenu）を出す。字はこの画面が描くので出さない
  const onContextMenu = (e: Event) => e.preventDefault();
  element.addEventListener("pointerdown", onPointerDown, true);
  element.addEventListener("pointermove", onPointerMove, true);
  element.addEventListener("pointerup", onPointerEnd, true);
  element.addEventListener("pointercancel", onPointerEnd, true);
  element.addEventListener("click", onClickCapture, true);
  element.addEventListener("contextmenu", onContextMenu);

  // ---------- つまみ ----------
  let drag: { side: "start" | "end"; fixed: number; boxes: CharBox[]; last: number } | undefined;
  const onHandleDown = (e: PointerEvent) => {
    const side = (e.currentTarget as HTMLElement).dataset.end as "start" | "end";
    e.preventDefault();
    e.stopPropagation();
    const { start, end } = target.selection();
    drag = { side, fixed: side === "start" ? end : start, boxes: readCharBoxes(element), last: side === "start" ? start : end };
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    log(`範囲：つまみを掴んだ（${side === "start" ? "頭" : "末"}・${start}〜${end}字目）`);
  };
  const onHandleMove = (e: PointerEvent) => {
    if (!drag) return;
    e.preventDefault();
    const to = caretFromPoint(drag.boxes, e.clientX, e.clientY, vertical());
    if (to === undefined || to === drag.last || to === drag.fixed) return;
    drag.last = to;
    target.select(drag.fixed, to);
  };
  const onHandleUp = (e: PointerEvent) => {
    if (!drag) return;
    const { start, end } = target.selection();
    log(`範囲：つまみを${e.type === "pointercancel" ? "取り消された" : "離した"}（${start}〜${end}字目）`);
    drag = undefined;
  };
  for (const handle of [handles.start, handles.end]) {
    handle.addEventListener("pointerdown", onHandleDown);
    handle.addEventListener("pointermove", onHandleMove);
    handle.addEventListener("pointerup", onHandleUp);
    handle.addEventListener("pointercancel", onHandleUp);
  }
  // 欄が送られたら、つまみを引くときの字の場所も読み直す
  element.addEventListener("scroll", () => {
    if (drag) drag.boxes = readCharBoxes(element);
  }, { passive: true });

  place();
  return () => {
    window.clearTimeout(pressTimer);
    cancelAnimationFrame(placing);
    watcher.disconnect();
    element.removeEventListener("scroll", placeSoon);
    window.removeEventListener("resize", placeSoon);
    element.removeEventListener("pointerdown", onPointerDown, true);
    element.removeEventListener("pointermove", onPointerMove, true);
    element.removeEventListener("pointerup", onPointerEnd, true);
    element.removeEventListener("pointercancel", onPointerEnd, true);
    element.removeEventListener("click", onClickCapture, true);
    element.removeEventListener("contextmenu", onContextMenu);
    layer.remove();
    host.classList.remove("range-host");
  };
}
