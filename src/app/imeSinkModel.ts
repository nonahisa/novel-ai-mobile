import { renderPaneHtml, type PaneState } from "./editContextModel";

/**
 * **見えない受け口の形（B の iOS 向け）の中身**（作者の答え 2026-11-07「iPhone にも足す」）。
 *
 * iOS の WKWebView には EditContext が無い見込みなので、B（右傍線）は前の試作の「見えない縦書きの受け口」
 * （`確認用コピー/縦書きの変換中の線の試作.html` の B2）の形で作る：
 *
 * - IME の入力は、カーソルの位置に重ねた**透明な textarea**（受け口）で受ける。ふつうの入力欄なので、
 *   どの端末でも日本語入力がそのまま動く
 * - 字と変換中の線はページが描く。変換中の字は `compositionupdate` の `data` で分かるので、
 *   本文のカーソルの位置に挟んで描き、**全体に1本の線**を引く（線の向きは CSS。縦書きは右）
 * - **文節ごとの太い線・細い線は分からない**（受け口には `textformatupdate` が届かない）。作者に伝えてある
 * - 確定（`compositionend`）か、変換を通らない字（`input`）で、受け口の中身を本文へ移し、受け口を空にする
 *
 * 描き方は EditContext の形（`editContextModel.ts`）の `renderPaneHtml` をそのまま使う。
 * 変換中の字を本文に挟んだ仮の本文を作り、その範囲に線の区切りを1つ置く。
 */

export interface SinkState {
  /** 確定した本文 */
  text: string;
  /** カーソルの位置（UTF-16 の単位） */
  selection: number;
  composing: boolean;
  /** 変換中の字（受け口の中で IME が組み立てている字） */
  compText: string;
}

export function initialSinkState(text: string): SinkState {
  return { text, selection: text.length, composing: false, compText: "" };
}

/** 描くための仮の本文（変換中の字を挟み、その範囲に線を1本） */
export function sinkDisplayState(state: SinkState): PaneState {
  if (!state.composing || state.compText === "") {
    return { text: state.text, selection: state.selection, composing: false, formats: [] };
  }
  const at = state.selection;
  const end = at + state.compText.length;
  return {
    text: state.text.slice(0, at) + state.compText + state.text.slice(at),
    selection: end,
    composing: true,
    formats: [{ start: at, end, style: "solid", thickness: "thin" }],
  };
}

export function renderSinkHtml(state: SinkState): string {
  return renderPaneHtml(sinkDisplayState(state));
}

/** 受け口の中身（確定した字）を本文のカーソルの位置へ移す */
export function commitSinkValue(state: SinkState, value: string): SinkState {
  if (value === "") return { ...state, composing: false, compText: "" };
  const text = state.text.slice(0, state.selection) + value + state.text.slice(state.selection);
  return { text, selection: state.selection + value.length, composing: false, compText: "" };
}

/**
 * 受け口の `beforeinput` のうち、ページが受け持つもの（受け口が空で、変換していないとき）。
 * 受け口は空なので、消す・改行は受け口の中では起きない。本文に当てる。
 */
export function pageEditFor(inputType: string, sinkValue: string, composing: boolean): "backspace" | "delete" | "newline" | undefined {
  if (composing) return undefined;
  if (inputType === "insertLineBreak" || inputType === "insertParagraph") return "newline";
  if (sinkValue !== "") return undefined;
  if (inputType === "deleteContentBackward") return "backspace";
  if (inputType === "deleteContentForward") return "delete";
  return undefined;
}
