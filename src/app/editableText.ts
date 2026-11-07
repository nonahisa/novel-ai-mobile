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

/** 欄の子の種類（字の節・改行・そのほかの要素） */
export type EditableChildKind = "text" | "br" | "other";

/**
 * 欄の中身が、こちらの決めた素直な形か：字の節1つ（本文が改行で終わるなら、うしろに支えの `<br>`）。
 * 素直でない形（字の節が割れている・空の節や `<br>`・`<div>` が残っている）は、変換していないときに
 * 本文から作り直す（2026-11-07 Mac G2a：iOS で Enter → ⌫ と戻すと、消した改行の跡が1字ぶんのすき間で残った）
 */
export function isPlainShape(children: readonly EditableChildKind[], text: string): boolean {
  if (text === "") return children.length === 0;
  const expected: EditableChildKind[] = trailingBreakNeeded(text) ? ["text", "br"] : ["text"];
  return children.length === expected.length && children.every((kind, i) => kind === expected[i]);
}

/**
 * 本文の `offset` 字目にカーソルを置くとき、素直な形の欄のどこに置くか。
 * 本文が改行で終わり、カーソルがその後ろ（最後の空の行）なら、支えの `<br>` の前に置く
 * （字の節の終わりの `\n` の後ろに置くと、iOS ではカーソルが見えず、ページが飛んだ。2026-11-07 Mac G3）
 */
export function caretPlacement(text: string, offset: number): { kind: "text"; offset: number } | { kind: "beforeBreak" } {
  const at = Math.min(Math.max(offset, 0), text.length);
  if (trailingBreakNeeded(text) && at === text.length) return { kind: "beforeBreak" };
  return { kind: "text", offset: at };
}

/** 本文の [start, end) を `inserted` に替える（Enter で改行を入れるとき） */
export function replaceRange(text: string, start: number, end: number, inserted: string): { text: string; caret: number } {
  const s = Math.min(Math.max(start, 0), text.length);
  const e = Math.min(Math.max(end, s), text.length);
  return { text: text.slice(0, s) + inserted + text.slice(e), caret: s + inserted.length };
}
