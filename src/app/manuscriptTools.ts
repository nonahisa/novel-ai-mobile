import { emphasisAction, readingProblem, rubySource, rubyTarget, tokenizeComposed, type RubyTarget } from "./composedText";

/**
 * **原稿エディターの道具帯の中身**（設計書 5.6。並びは作者が実機で打ってから決める【案】）。
 *
 * ［取り消し］［やり直し］［ルビ］［傍点］［「」］［――］［……］。「書く」面（記法をそのまま見せる欄）の上で、
 * 本文と選んだ範囲から、次の本文と選ぶ範囲を作る。DOM には触らない（テストのため）。
 * ルビ・傍点の決まりは縦書きの試しの C と同じ（`composedText.ts`。記法は `{漢字|かんじ}`・`{{語}}`）。
 */

export interface TextEdit {
  text: string;
  selStart: number;
  selEnd: number;
}

export type ToolResult = { ok: true; edit: TextEdit } | { ok: false; reason: string };

/** 選んだ範囲を `insert` に替え、カーソルをそのうしろへ（――・……） */
export function insertText(text: string, start: number, end: number, insert: string): TextEdit {
  const caret = start + insert.length;
  return { text: text.slice(0, start) + insert + text.slice(end), selStart: caret, selEnd: caret };
}

/** 「」：選んでいればその字を括り、選んでいなければ「」を入れてカーソルを中へ */
export function wrapBrackets(text: string, start: number, end: number, open = "「", close = "」"): TextEdit {
  const inner = text.slice(start, end);
  const next = text.slice(0, start) + open + inner + close + text.slice(end);
  if (start === end) return { text: next, selStart: start + open.length, selEnd: start + open.length };
  // 括った字のうしろ（閉じ括弧のあと）へ
  const caret = start + open.length + inner.length + close.length;
  return { text: next, selStart: caret, selEnd: caret };
}

/** ［ルビ］：どこに振るか（読みを訊く前に決める） */
export function rubyPlan(text: string, start: number, end: number): RubyTarget {
  return rubyTarget(text, tokenizeComposed(text), start, end);
}

/** ［ルビ］：読みが決まったあと。読みが空なら、直すルビを外す（親の字だけ残す） */
export function applyRuby(text: string, target: Exclude<RubyTarget, { kind: "none" }>, reading: string): ToolResult {
  const problem = readingProblem(reading);
  if (problem) return { ok: false, reason: problem };
  const [from, to, base] =
    target.kind === "new"
      ? [target.start, target.end, target.base]
      : [target.chunk.start, target.chunk.start + target.chunk.src.length, target.chunk.base];
  if (target.kind === "new" && reading === "") return { ok: false, reason: "読みを入れてください" };
  return { ok: true, edit: insertText(text, from, to, rubySource(base, reading)) };
}

/** ［傍点］：付け外しの切り替え */
export function toggleEmphasis(text: string, start: number, end: number): ToolResult {
  const action = emphasisAction(text, tokenizeComposed(text), start, end);
  if (action.kind === "none") return { ok: false, reason: action.reason };
  return { ok: true, edit: insertText(text, action.start, action.end, action.src) };
}

/** 道具帯の並び（設計書 5.6 の案のとおり。向きの押し口は上のバー） */
export const TOOL_STRIP = [
  { id: "undo", label: "取り消し" },
  { id: "redo", label: "やり直し" },
  { id: "ruby", label: "ルビ" },
  { id: "emphasis", label: "傍点" },
  { id: "brackets", label: "「」" },
  { id: "dash", label: "――" },
  { id: "ellipsis", label: "……" },
] as const;

export type ToolId = (typeof TOOL_STRIP)[number]["id"];
