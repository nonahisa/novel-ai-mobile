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
