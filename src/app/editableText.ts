/**
 * **A（いまの形）を contenteditable にしたときの、本文と DOM の対応**（作者の答え 2026-11-07
 * 「両方」：用語の色付けを A にも足す。A は textarea では中の字に色を付けられないので、本体の原稿
 * エディターと同じ contenteditable に替える）。
 *
 * 入力欄の中身は、ふつう「字の節（text node）」と改行（`<br>`、ブラウザが作る `<div>` の区切り）で
 * できている。本文の何字目が、どの節の何字目かを数えるのがここ。DOM には触らない（テストのため）。
 * DOM をたどって節の並びを作るのは `editablePane.ts`。
 *
 * - 字の節はそのまま本文になる（中の `\n` も改行）
 * - `<br>` は改行1つ（ブラウザが入れたとき。こちらは入れない）
 * - 本文が改行で終わるとき、最後の空の行にカーソルを置けるように、字の節の末に**見えない支えの字**
 *   （`LINE_SUPPORT`＝U+200B）を1つ足す。本文を読むときは数えない（`stripSupport`）。
 *   はじめは支えに `<br>` を使っていたが、iOS（WebKit）は縦書きで `<br>` の前のカーソルの位置を 0〜0 と返し、
 *   印も描かなかった（2026-11-07 Mac #20〜#23。「ねこ」と打ってカーソルが字の中に入ると印が出た）
 * - `<div>`・`<p>` の頭は、前に字があれば改行1つ（ブラウザが段落で区切ったとき）
 */

export type EditableSegment<N> = { kind: "text"; node: N; text: string } | { kind: "newline"; node: N };

/** 節の並びから本文を作る */
export function segmentsText<N>(segments: readonly EditableSegment<N>[]): string {
  return segments.map((s) => (s.kind === "text" ? s.text : "\n")).join("");
}

/**
 * 本文の `offset` 字目に当たる、字の節の中の位置。
 * 範囲の頭（`start`）なら、その字を含む節の頭寄り、尻（`end`）なら前の字を含む節の尻寄りを選ぶ
 * （節の境目で、隣の節へはみ出した範囲を作らないため）。字の節に当たらなければ undefined
 */
export function locateOffset<N>(
  segments: readonly EditableSegment<N>[],
  offset: number,
  side: "start" | "end"
): { node: N; offset: number } | undefined {
  let at = 0;
  for (const s of segments) {
    const length = s.kind === "text" ? s.text.length : 1;
    if (s.kind === "text") {
      const inside = side === "start" ? offset >= at && offset < at + length : offset > at && offset <= at + length;
      if (inside) return { node: s.node, offset: offset - at };
    }
    at += length;
  }
  return undefined;
}

/** 欄の子の種類（字の節・<br>・そのほかの要素） */
export type EditableChildKind = "text" | "br" | "other";

/** 本文が改行で終わるなら、最後の空の行を見せるための支え（`LINE_SUPPORT`）が要る */
export function trailingBreakNeeded(text: string): boolean {
  return text.endsWith("\n");
}

/** 最後の空の行を支える見えない字（U+200B）。本文には数えない */
export const LINE_SUPPORT = "​";

/** 本文から、欄に書く字の節の中身を作る（改行で終わるなら支えの字を足す） */
export function plainValue(text: string): string {
  return trailingBreakNeeded(text) ? text + LINE_SUPPORT : text;
}

/** 欄の字から支えの字を除く（本文の U+200B もいっしょに除く。原稿にはまず無い字なので、そう決める） */
export function stripSupport(value: string): string {
  return value.split(LINE_SUPPORT).join("");
}

/**
 * 欄の中身が素直な形か：本文が空なら何も無い。そうでなければ字の節1つで、中身が `plainValue(text)`
 * （`raw` は1つ目の字の節の中身）
 */
export function isPlainShape(children: readonly EditableChildKind[], text: string, raw: string | null = null): boolean {
  if (text === "") return children.length === 0 || (children.length === 1 && children[0] === "text" && raw === "");
  return children.length === 1 && children[0] === "text" && raw === plainValue(text);
}

/** 素直な形の欄で、本文の offset 字目のカーソルは、字の節のその位置（支えの字の前） */
export function caretPlacement(text: string, offset: number): { kind: "text"; offset: number } {
  return { kind: "text", offset: Math.min(Math.max(offset, 0), text.length) };
}

export function replaceRange(text: string, start: number, end: number, inserted: string): { text: string; caret: number } {
  const s = Math.min(Math.max(start, 0), text.length);
  const e = Math.min(Math.max(end, s), text.length);
  return { text: text.slice(0, s) + inserted + text.slice(e), caret: s + inserted.length };
}

export interface CaretBox {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/**
 * **前後の字の位置から、カーソルの位置を決める**（欄に触らずに測る。変換中に印を置いて測ると、変換が切れる）。
 * iOS は縦書きの欄で、カーソルの位置を 0〜0 と返したり、印を大きくずれた所に描いたりする
 * （2026-11-08 iPad mini 実機。出先の原稿エディター〈本体の設計書 6.116〉でも、2026-10-24 に同じだった）。
 *
 * - 前の字があれば、その字の尻（縦書きは下の端、横書きは右の端）
 * - 無ければ、うしろの字の頭（縦書きは上の端、横書きは左の端）
 * - どちらも無ければ undefined（改行の字は、呼ぶ側で渡さない）
 */
export function caretFromNeighbors(prev: CaretBox | undefined, next: CaretBox | undefined, vertical: boolean): CaretBox | undefined {
  if (prev) {
    return vertical
      ? { left: prev.left, right: prev.right, top: prev.bottom, bottom: prev.bottom }
      : { left: prev.right, right: prev.right, top: prev.top, bottom: prev.bottom };
  }
  if (next) {
    return vertical
      ? { left: next.left, right: next.right, top: next.top, bottom: next.top }
      : { left: next.left, right: next.left, top: next.top, bottom: next.bottom };
  }
  return undefined;
}

/**
 * **自前の印の大きさ**。縦書きは横の棒（列の太さ×2）、横書きは縦の棒（2×行の高さ）。
 * 太さ・高さは箱の左右・上下の差から出す（2026-11-12 iPad mini・0.1.17 の記録：字の箱から出した位置
 * 〈`caretFromNeighbors`〉には width が無く、`Math.max(undefined, …)` が NaN になって、印の幅が 0 だった。
 * 0.1.13 から「印が出ない」のはこれ）
 */
export function ownCaretSize(at: CaretBox, vertical: boolean, lineHeight: number): { width: number; height: number } {
  const span = (n: number) => (Number.isFinite(n) && n > 0 ? n : 0);
  return vertical
    ? { width: Math.max(span(at.right - at.left), lineHeight), height: 2 }
    : { width: 2, height: Math.max(span(at.bottom - at.top), lineHeight) };
}

/**
 * **縦書きで、押した点にいちばん近い字の境目を選ぶ**（本体の出先の原稿エディター `nearestCaret` に倣う。
 * iPad は caretRangeFromPoint でも、自分で置くカーソルでも、縦書きで1字ずれた。本体 2026-10-05）。
 *
 * 候補は境目ごとに、うしろの字の箱（`after`：その字の上の辺が境目）か、前の字の箱（下の辺が境目）。
 * 押した点との上下の差で比べ、列（左右）が字の幅より離れた候補は選ばない。
 * どの列にも入っていない（行の外の空白を押した）なら undefined（置き直さない）
 */
export function nearestBoundary(
  candidates: { offset: number; box: CaretBox; after: boolean }[],
  x: number,
  y: number
): number | undefined {
  let best: number | undefined;
  let bestD = Infinity;
  for (const c of candidates) {
    const edge = c.after ? c.box.top : c.box.bottom;
    const center = (c.box.left + c.box.right) / 2;
    if (Math.abs(center - x) > c.box.right - c.box.left) continue;
    const d = Math.abs(edge - y);
    if (d < bestD) {
      bestD = d;
      best = c.offset;
    }
  }
  return best;
}

/**
 * **iPad が置いたカーソルを、押した点の近くへ置き直すか**（本体 `applyTouchFix` に倣う）。
 * iPad の置いた所の隣（前後1字）へ直すときだけ置き直す。キーボードが出てページが送られていると、
 * 指の座標が実際とずれて届き、座標から引いた所のほうが遠くなることがある（本体 2026-10-05）
 */
export function shouldMoveCaret(native: number | undefined, wanted: number): boolean {
  if (native === undefined) return true;
  return Math.abs(native - wanted) === 1;
}

/**
 * **ページを送るときに使うカーソルの位置を、欄の中に収める**（上下だけ）。
 * iOS（WebKit）は縦書きの欄の最後の空の列のカーソルを、欄の下の枠の外と測ることがある。
 * その位置のままページを送ると、ページが下へ送られて欄の上側が見えなくなった（2026-11-07 Mac #19 I1）。
 *
 * - 欄と重なっていれば、重なっている所
 * - 縦書きで欄の外なら、列の頭（欄の上の端）。新しい列のカーソルは列の頭にある
 * - 横書きで欄の外なら、近いほうの端
 */
export function clampCaretToPane(caret: CaretBox, pane: CaretBox, vertical: boolean): CaretBox {
  const height = Math.max(1, Math.min(caret.bottom - caret.top || 20, pane.bottom - pane.top));
  const top = Math.max(caret.top, pane.top);
  const bottom = Math.min(caret.bottom, pane.bottom);
  if (bottom > top) return { ...caret, top, bottom };
  if (vertical || caret.bottom <= pane.top) return { ...caret, top: pane.top, bottom: pane.top + height };
  return { ...caret, top: pane.bottom - height, bottom: pane.bottom };
}
