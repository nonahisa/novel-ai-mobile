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
 * - `<br>` は改行1つ。ただし**欄のいちばん後ろの `<br>` は数えない**（本文が改行で終わるとき、
 *   最後の空の行にカーソルを置けるように、こちらで入れる支えの `<br>`。`trailingBreakNeeded`）
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

/** 本文が改行で終わるなら、最後の空の行を見せるための支えの `<br>` が要る */
export function trailingBreakNeeded(text: string): boolean {
  return text.endsWith("\n");
}
