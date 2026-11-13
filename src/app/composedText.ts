import { INTERNAL_EMPHASIS_SOURCE, INTERNAL_RUBY_SOURCE } from "../shared";
import { LINE_SUPPORT, stripSupport } from "./editableText";

/**
 * **C（組んで書く）の中身**：ルビ・傍点を振り仮名・圏点で組んだまま打つ欄の、本文と塊の決まり
 * （2026-11-13 作者「ルビと傍点の表示の状態で、書けるようにできるでしょうか？」→ 選択肢の 1
 * 「まず縦書きの試しで、本体と同じ『塊』の形を試し、iPad と Android で打ってみる」）。
 *
 * 本体の原稿エディターの「組んで書く」面（本体の設計書 6.34）と同じ考え：
 * - ルビ・傍点は **`contenteditable="false"` の塊**にし、元の記法を `data-src` に持たせる。
 *   塊の中には打てない。⌫ で塊ごと消える
 * - 欄に入る前に「記法 → 組んだ欄 → 記法」の往復が本文と1字も違わないかを確かめ、違えば組まずに
 *   記法のまま出す（安全弁。本体の 6.34.5）
 * - 読みの空のルビ（`{漢字|}`）は組まずに記法のまま出す（本体と同じ）
 *
 * 記法は本体の拡張機能の記法（`{漢字|かんじ}`・`{{語}}`。`.md` と同じ）。規則は本体の `core/ruby.ts`
 * の正規表現の字をそのまま使う（写さない）。傍点を先に見る（`{{語}}` がルビに読まれないように）。
 * DOM には触らない（テストのため）。欄を組むのは `composedPane.ts`。
 */

export type ComposedToken =
  | { kind: "text"; start: number; text: string }
  | { kind: "ruby"; start: number; src: string; base: string; reading: string }
  | { kind: "emphasis"; start: number; src: string; inner: string };

export type ComposedChunk = Exclude<ComposedToken, { kind: "text" }>;

const NOTATION = new RegExp(`${INTERNAL_EMPHASIS_SOURCE}|${INTERNAL_RUBY_SOURCE}`, "g");

/** 本文を、地の字と塊（ルビ・傍点）に分ける。**本文は1字も落とさない**（全部つなぐと元の本文） */
export function tokenizeComposed(text: string): ComposedToken[] {
  const out: ComposedToken[] = [];
  let last = 0;
  const pushText = (end: number) => {
    if (end <= last) return;
    const prev = out[out.length - 1];
    // 組まなかった記法（読みの空のルビ）は、前の地の字につなぐ
    if (prev && prev.kind === "text") prev.text += text.slice(last, end);
    else out.push({ kind: "text", start: last, text: text.slice(last, end) });
    last = end;
  };
  for (const match of text.matchAll(NOTATION)) {
    const start = match.index;
    const src = match[0];
    pushText(start);
    if (match[1] !== undefined) {
      out.push({ kind: "emphasis", start, src, inner: match[1] });
    } else if (match[3]) {
      out.push({ kind: "ruby", start, src, base: match[2]!, reading: match[3] });
    } else {
      // 読みが空のルビは組まない（地の字として、記法のまま見せる）
      pushText(start + src.length);
      continue;
    }
    last = start + src.length;
  }
  pushText(text.length);
  return out;
}

export function isChunk(token: ComposedToken): token is ComposedChunk {
  return token.kind !== "text";
}

export function tokenLength(token: ComposedToken): number {
  return token.kind === "text" ? token.text.length : token.src.length;
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** 塊1つの HTML */
export function chunkHtml(chunk: ComposedChunk): string {
  const attrs = `contenteditable="false" data-src="${escapeHtml(chunk.src)}"`;
  if (chunk.kind === "ruby") {
    return `<span class="chunk chunk-ruby" ${attrs}><ruby>${escapeHtml(chunk.base)}<rt>${escapeHtml(chunk.reading)}</rt></ruby></span>`;
  }
  return `<span class="chunk chunk-em" ${attrs}><span class="bouten">${escapeHtml(chunk.inner)}</span></span>`;
}

/**
 * **組んだ欄の HTML**。地の字は字の節（改行は `\n` のまま。欄は `white-space: pre-wrap`）。
 * カーソルを塊の前後へ置けるように、**塊の両隣にはいつも字の節を置く**。隣に地の字が無いとき
 * （欄の頭・欄の末・塊が2つ続くところ）と、本文が改行で終わるときは、見えない支えの字
 * （`LINE_SUPPORT`。本文には数えない）を置く
 */
export function composedHtml(tokens: readonly ComposedToken[]): string {
  let html = "";
  let prevWasChunk = true; // 欄の頭は「前が塊」と同じ扱い（塊で始まるなら、前に支えの字を置く）
  tokens.forEach((token) => {
    if (token.kind === "text") {
      html += escapeHtml(token.text);
      prevWasChunk = false;
      return;
    }
    if (prevWasChunk) html += LINE_SUPPORT;
    html += chunkHtml(token);
    prevWasChunk = true;
  });
  const last = tokens[tokens.length - 1];
  if (!last || last.kind !== "text" || last.text.endsWith("\n")) html += LINE_SUPPORT;
  return html;
}

/** 欄を読み戻すための、DOM の節の最小の形（テストでは手で作る） */
export interface NodeLike {
  nodeType: number;
  nodeName: string;
  nodeValue: string | null;
  childNodes: ArrayLike<NodeLike>;
  getAttribute?(name: string): string | null;
}

const TEXT_NODE = 3;
const ELEMENT_NODE = 1;

/**
 * **欄を本文へ読み戻す**：字の節はそのまま（支えの字は除く）、塊は `data-src`、`<br>` は改行、
 * ブラウザが作った `<div>`・`<p>` の頭は（前に字があれば）改行。そのほかの要素は中の字を読む
 */
export function readComposed(root: NodeLike): string {
  let out = "";
  const walk = (node: NodeLike, top: boolean) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === TEXT_NODE) {
        out += stripSupport(child.nodeValue ?? "");
      } else if (child.nodeType === ELEMENT_NODE) {
        const src = child.getAttribute?.("data-src");
        if (src !== null && src !== undefined) {
          out += src;
        } else if (child.nodeName === "BR") {
          // 欄のいちばん後ろの <br> は、ブラウザが最後の空の行を支えるために置いたもの
          const siblings = Array.from(node.childNodes);
          if (!(top && child === siblings[siblings.length - 1])) out += "\n";
        } else {
          const block = child.nodeName === "DIV" || child.nodeName === "P";
          if (block && out !== "" && !out.endsWith("\n")) out += "\n";
          walk(child, false);
        }
      }
    }
  };
  walk(root, true);
  return out;
}

/** 塊の形の並び（字は見ない）。欄の塊と本文の塊が合っているかを比べる */
export function chunkSignature(tokens: readonly ComposedToken[]): string {
  return tokens.filter(isChunk).map((t) => t.src).join("\u0000");
}

/** 本文の offset 字目が、塊の中（両端を除く）なら、その塊 */
export function chunkAround(tokens: readonly ComposedToken[], offset: number): ComposedChunk | undefined {
  return tokens.find((t): t is ComposedChunk => isChunk(t) && offset > t.start && offset < t.start + t.src.length);
}

/**
 * **カーソルを塊の外へ出す**：塊の中に来たら、近いほうの端へ（同じ近さなら後ろ。本体も、ルビの中には
 * カーソルを入れず、近いほうの外側へ出す）
 */
export function snapOutOfChunk(tokens: readonly ComposedToken[], offset: number): number {
  const chunk = chunkAround(tokens, offset);
  if (!chunk) return offset;
  const end = chunk.start + chunk.src.length;
  return offset - chunk.start < end - offset ? chunk.start : end;
}

/** 範囲の両端を、塊を割らないように外へ広げる（塊にかかった範囲は塊ごと） */
export function widenToChunks(tokens: readonly ComposedToken[], start: number, end: number): { start: number; end: number } {
  const head = chunkAround(tokens, start);
  const tail = chunkAround(tokens, end);
  return { start: head ? head.start : start, end: tail ? tail.start + tail.src.length : end };
}

/**
 * **消す範囲**（⌫・Delete。2026-11-13 作者の答えの2本目「⌫ で塊ごと消す」）。
 * - 範囲を選んでいれば、塊を割らないように広げた範囲
 * - カーソルのすぐ前（⌫）・すぐ後（Delete）が塊なら、その塊まるごと
 * - そうでなければ undefined（地の字の1字消しはブラウザに任せる。こちらで組み直すと、iOS がカーソルの
 *   印を描かなくなることがあった〈A の 2026-11-07 Mac #24〉ので、塊のときだけ手を出す）
 */
export function deleteRange(
  tokens: readonly ComposedToken[],
  start: number,
  end: number,
  direction: "backward" | "forward"
): { start: number; end: number; chunk?: ComposedChunk } | undefined {
  if (start !== end) {
    const wide = widenToChunks(tokens, start, end);
    return wide.start !== start || wide.end !== end || tokens.some((t) => isChunk(t) && t.start >= wide.start && t.start < wide.end)
      ? wide
      : undefined;
  }
  const chunk = tokens.find(
    (t): t is ComposedChunk => isChunk(t) && (direction === "backward" ? t.start + t.src.length === start : t.start === start)
  );
  return chunk ? { start: chunk.start, end: chunk.start + chunk.src.length, chunk } : undefined;
}

/** 記録に残す、カーソルの所の様子（塊の直前・直後・地の字）。実機の確かめを記録で裏付けるため */
export function describeCaretAt(tokens: readonly ComposedToken[], offset: number): string {
  const label = (c: ComposedChunk) => (c.kind === "ruby" ? `ルビ「${c.base}」` : `傍点「${c.inner}」`);
  const inside = chunkAround(tokens, offset);
  if (inside) return `${offset}字目（${label(inside)}の中）`;
  const before = tokens.find((t): t is ComposedChunk => isChunk(t) && t.start + t.src.length === offset);
  const after = tokens.find((t): t is ComposedChunk => isChunk(t) && t.start === offset);
  const parts = [before ? `${label(before)}の直後` : "", after ? `${label(after)}の直前` : ""].filter(Boolean);
  return `${offset}字目（${parts.length ? parts.join("・") : "地の字"}）`;
}

/*
 * ---------- ［ルビ］［傍点］（3本目。本体の「ルビ付与」「傍点付与」に倣う） ----------
 */

/** ルビ・傍点の親の字に使えない字（記法を壊す字と改行） */
const BAD_IN_NOTATION = /[{}|\r\n]/;
/** カーソルの前の漢字のまとまり（選んでいないときに振る所。Android詳細設計書 5.6） */
const KANJI_RUN = /[一-鿿㐀-䶿豈-﫿々〆ヶ]+$/u;

export type RubyTarget =
  | { kind: "new"; start: number; end: number; base: string }
  | { kind: "edit"; chunk: Extract<ComposedChunk, { kind: "ruby" }> }
  | { kind: "none"; reason: string };

/**
 * **［ルビ］を押したとき、どこに振るか**。
 * - 選んだ範囲・カーソルがルビの塊にかかっていれば、そのルビの読みを直す（本体も、ルビのある所で振ると重ねずに読みの直しになる）
 * - カーソルのすぐ前がルビの塊なら、そのルビの読みを直す
 * - 範囲を選んでいれば、その字に振る（改行・記法の字・ほかの塊を含むなら振らない）
 * - 選んでいなければ、カーソルの前の漢字のまとまりに振る
 */
export function rubyTarget(text: string, tokens: readonly ComposedToken[], start: number, end: number): RubyTarget {
  const isRuby = (t: ComposedToken): t is Extract<ComposedChunk, { kind: "ruby" }> => t.kind === "ruby";
  const touching = tokens.find((t) => isRuby(t) && ((start < t.start + t.src.length && end > t.start) || t.start + t.src.length === start && start === end));
  if (touching && isRuby(touching)) return { kind: "edit", chunk: touching };
  if (start !== end) {
    const base = text.slice(start, end);
    if (tokens.some((t) => isChunk(t) && t.start < end && t.start + t.src.length > start)) return { kind: "none", reason: "傍点の塊を含む所には振れません" };
    if (BAD_IN_NOTATION.test(base)) return { kind: "none", reason: "改行や { } | を含む所には振れません" };
    return { kind: "new", start, end, base };
  }
  const run = KANJI_RUN.exec(text.slice(0, start));
  if (!run) return { kind: "none", reason: "振る字を選んでから押してください（カーソルの前に漢字があれば、その漢字に振ります）" };
  return { kind: "new", start: start - run[0].length, end: start, base: run[0] };
}

/** 読みとして使えるか。使えなければ理由 */
export function readingProblem(reading: string): string | undefined {
  return BAD_IN_NOTATION.test(reading) ? "読みに改行や { } | は使えません" : undefined;
}

/** ルビの記法（読みが空なら親の字だけ。ルビを外す） */
export function rubySource(base: string, reading: string): string {
  return reading === "" ? base : `{${base}|${reading}}`;
}

export type EmphasisAction =
  | { kind: "add"; start: number; end: number; src: string }
  | { kind: "remove"; start: number; end: number; src: string }
  | { kind: "none"; reason: string };

/**
 * **［傍点］を押したとき**（本体と同じく付け外しの切り替え）。
 * - 選んだ範囲・カーソルのすぐ前が傍点の塊なら、傍点を外す（中の字は残す）
 * - 範囲を選んでいれば、その字に傍点を付ける（改行・記法の字・ルビの塊を含むなら付けない）
 * - 選んでいなければ、字を選ぶよう知らせる
 */
export function emphasisAction(text: string, tokens: readonly ComposedToken[], start: number, end: number): EmphasisAction {
  const em = tokens.find(
    (t): t is Extract<ComposedChunk, { kind: "emphasis" }> =>
      t.kind === "emphasis" && ((start < t.start + t.src.length && end > t.start) || (start === end && t.start + t.src.length === start))
  );
  if (em) return { kind: "remove", start: em.start, end: em.start + em.src.length, src: em.inner };
  if (start === end) return { kind: "none", reason: "傍点を付ける字を選んでから押してください" };
  const inner = text.slice(start, end);
  if (tokens.some((t) => isChunk(t) && t.start < end && t.start + t.src.length > start)) return { kind: "none", reason: "ルビの塊を含む所には付けられません" };
  if (BAD_IN_NOTATION.test(inner)) return { kind: "none", reason: "改行や { } | を含む所には付けられません" };
  return { kind: "add", start, end, src: `{{${inner}}}` };
}
