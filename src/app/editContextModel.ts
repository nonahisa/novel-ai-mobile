/**
 * **変換中の線を右に出す形（B）の中身**（作者の頼み 2026-11-07「縦書横書きの試しは、右傍線のものと二種作ってください」）。
 *
 * いまの原稿エディターの形（A。ブラウザの入力欄）では、縦書きの変換中の線はブラウザが描き、
 * **行の左に出る**（Android の WebView・iOS シミュレーターとも。実機確認リスト49行）。日本語の縦書きでは
 * 右に出るのが決まり。前の試作（`確認用コピー/縦書きの変換中の線の試作.html`、2026-11-04 未明。
 * 本体の `docs/オリジナルIME設計書.md` Q-09）で、**EditContext を使い、字と変換中の線をページが
 * 描くと、線が右に出る**ことを作者の Chrome と MS-IME で確かめた。ここはそれを移したもの。
 *
 * - EditContext は IME から「どこをどう書き換えたか（`textupdate`）」と「変換中の区切りと線の形
 *   （`textformatupdate`）」を受け取るだけで、字は描かない。だから字を1字ずつ span にして並べ、
 *   変換中の字にだけ線のクラスを付ける（線の向きは CSS の `text-underline-position`）
 * - 改行・削除・カーソル移動もページが受け持つ
 * - **わかっている弱み**（Q-09）：候補の窓が横書きになる（Chromium が EditContext のとき縦書きの印を
 *   立てないため）。ルビ・傍点・選択・元に戻すは作り直しになる。この試しでは、ルビ・傍点は下の
 *   「ルビと傍点の表示」で見る（入力欄の中では記法の字のまま）
 *
 * EditContext は Chromium の機能。Android の WebView にはある見込み、iOS の WKWebView には無い見込み。
 * 無ければ B を押せなくし、理由を出す（`editContextSupport`）。
 *
 * ここは DOM に触らない（テストのため）。描く・受けるのは `editContextPane.ts`。
 */

import type { TermSpan } from "./termHighlight";

/** 変換中の区切り1つ（本文の頭からの位置）と線の形 */
export interface CompositionFormat {
  start: number;
  end: number;
  /** "none" | "solid" | "dotted" | "dashed" | "wavy"（EditContext の underlineStyle） */
  style: string;
  /** "none" | "thin" | "thick" */
  thickness: string;
}

export interface PaneState {
  text: string;
  /** カーソルの位置（字の数。UTF-16 の単位。EditContext と同じ数え方） */
  selection: number;
  composing: boolean;
  formats: CompositionFormat[];
}

export type Orientation = "vertical" | "horizontal";

export function initialPaneState(text: string): PaneState {
  return { text, selection: text.length, composing: false, formats: [] };
}

/** IME の `textupdate`（[start, end) を `inserted` に置き換え、カーソルを selection へ） */
export function applyTextUpdate(
  state: PaneState,
  update: { start: number; end: number; text: string; selection: number }
): PaneState {
  const start = clamp(update.start, 0, state.text.length);
  const end = clamp(update.end, start, state.text.length);
  const text = state.text.slice(0, start) + update.text + state.text.slice(end);
  return { ...state, text, selection: clamp(update.selection, 0, text.length) };
}

/** ページが受け持つ書き換え（改行・削除）。EditContext へも同じ書き換えを伝える必要がある */
export function editAtCaret(state: PaneState, kind: "newline" | "backspace" | "delete"): { state: PaneState; start: number; end: number; inserted: string } | undefined {
  const at = state.selection;
  if (kind === "newline") return replace(state, at, at, "\n");
  if (kind === "backspace") return at > 0 ? replace(state, at - previousLength(state.text, at), at, "") : undefined;
  return at < state.text.length ? replace(state, at, at + nextLength(state.text, at), "") : undefined;
}

function replace(state: PaneState, start: number, end: number, inserted: string) {
  const text = state.text.slice(0, start) + inserted + state.text.slice(end);
  return { state: { ...state, text, selection: start + inserted.length }, start, end, inserted };
}

/** サロゲートペア（𠮷 など）を半分に割らない */
function previousLength(text: string, at: number): number {
  const code = text.charCodeAt(at - 1);
  return code >= 0xdc00 && code <= 0xdfff && at >= 2 ? 2 : 1;
}
function nextLength(text: string, at: number): number {
  const code = text.charCodeAt(at);
  return code >= 0xd800 && code <= 0xdbff && at + 1 < text.length ? 2 : 1;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(Math.max(n, min), max);
}

function escapeChar(ch: string): string {
  return ch === "&" ? "&amp;" : ch === "<" ? "&lt;" : ch === ">" ? "&gt;" : ch;
}

/** 変換中の字の線のクラス（形が "none" の区切りには線を引かない） */
export function lineClassAt(state: PaneState, index: number): string {
  if (!state.composing) return "";
  // Android の WebView は形の名前を "Solid"・"Thin"・"None" のように大文字で始めて送る（2026-11-07 エミュレーター）。
  // 同じ範囲に「線なし」の区切りも重ねて届くので、線のある区切りを選ぶ
  const covering = state.formats.filter((f) => index >= f.start && index < f.end);
  const format = covering.find((f) => f.style.toLowerCase() !== "none");
  if (!format) return "";
  const style = format.style.toLowerCase();
  const classes = ["comp"];
  if (format.thickness.toLowerCase() === "thick") classes.push("thick");
  if (style === "dotted" || style === "dashed" || style === "wavy") classes.push(style);
  return classes.join(" ");
}

/**
 * 1字ずつ span にした HTML（候補の窓の位置を IME へ返すとき、字の場所が要るため）。
 * サロゲートペアは2つの位置を1つの span にまとめる（`data-i` は頭の位置、`data-n` は単位の数）
 */
export function renderPaneHtml(state: PaneState, terms: readonly TermSpan[] = []): string {
  let html = "";
  let i = 0;
  // 用語は前から順に並んでいて重ならない（`findTermSpans`）。字を進めながら、いま当たっている用語を追う
  let t = 0;
  while (i <= state.text.length) {
    if (i === state.selection) html += '<span class="caret" aria-hidden="true">&#8203;</span>';
    if (i === state.text.length) break;
    const n = nextLength(state.text, i);
    const ch = state.text.slice(i, i + n);
    if (ch === "\n") {
      html += `<span data-i="${i}" data-n="1">\n</span>`;
    } else {
      while (t < terms.length && terms[t].end <= i) t++;
      const term = t < terms.length && terms[t].start <= i ? `term-${terms[t].kind}` : "";
      const cls = [lineClassAt(state, i), term].filter(Boolean).join(" ");
      html += `<span data-i="${i}" data-n="${n}"${cls ? ` class="${cls}"` : ""}>${escapeChar(ch)}</span>`;
    }
    i += n;
  }
  return html;
}

/**
 * EditContext の形を使えるか。使えなければ作者へ出す理由。
 * 使えないときも B は押せる（見えない受け口の形 `imeSinkModel.ts` になる。作者の答え 2026-11-07「iPhone にも足す」）
 */
export function editContextSupport(win: object, platform: string): { ok: true } | { ok: false; reason: string } {
  if ("EditContext" in win) return { ok: true };
  if (platform === "ios") {
    return {
      ok: false,
      reason:
        "iOS の WebView（WKWebView）には EditContext が無いので、B は「見えない受け口」の形で動きます。",
    };
  }
  return { ok: false, reason: "この画面の部品（WebView）には EditContext が無いので、B は「見えない受け口」の形で動きます。" };
}
