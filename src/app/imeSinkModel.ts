import { renderPaneHtml, type PaneState } from "./editContextModel";
import type { TermSpan } from "./termHighlight";

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

export function renderSinkHtml(state: SinkState, terms: readonly TermSpan[] = []): string {
  return renderPaneHtml(sinkDisplayState(state), terms);
}

/** 受け口の中身（確定した字）を本文のカーソルの位置へ移す */
export function commitSinkValue(state: SinkState, value: string): SinkState {
  if (value === "") return { ...state, composing: false, compText: "" };
  const text = state.text.slice(0, state.selection) + value + state.text.slice(state.selection);
  return { text, selection: state.selection + value.length, composing: false, compText: "" };
}

/**
 * **受け口にいつも入れておく見えない字**（幅のない空白 U+200B）。
 *
 * iOS の WebView は、受け口が空のとき、消すキー（⌫）を押しても何の知らせも出さない
 * （keydown も beforeinput も来ない。2026-11-07 Mac の iOS シミュレーター）。そこで受け口に
 * この字を1つ置いておき、**それが消えたことで「後ろへ消す」を読む**。本文には入れない。
 */
export const SINK_SENTINEL = "\u200B";

/**
 * 受け口の今の中身から、何が起きたかを読む（変換していないときの `input` で使う）。
 * - 頭の見えない字が消えていれば「後ろへ消す」が1回
 * - 見えない字のほかに字があれば、それを確定した字として本文へ入れる
 */
export function readSinkValue(value: string): { backspace: boolean; inserted: string } {
  const backspace = !value.startsWith(SINK_SENTINEL);
  const inserted = value.split(SINK_SENTINEL).join("");
  return { backspace, inserted };
}

/**
 * 受け口の `beforeinput` のうち、ページが受け持つもの（変換していないとき）。
 * 改行と、受け口に見えない字しか無いときの「前へ消す」。
 * 「後ろへ消す」はここで扱わない（iOS では来ないので、見えない字が消えたことで読む。`readSinkValue`）
 */
export function pageEditFor(inputType: string, sinkValue: string, composing: boolean): "delete" | "newline" | undefined {
  if (composing) return undefined;
  if (inputType === "insertLineBreak" || inputType === "insertParagraph") return "newline";
  if (inputType === "deleteContentForward" && sinkValue.split(SINK_SENTINEL).join("") === "") return "delete";
  return undefined;
}
