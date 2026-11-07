import { TERM_COLORS, TermIndex, expandNameVariants, type TermEntry, type TermKind } from "../shared";

/**
 * **用語の色付け**（作者の答え 2026-11-07「両方」：B（右傍線）にも、A を本体と同じ contenteditable に
 * 替えた形にも足す）。
 *
 * - 本文のどこが用語かは**本体の索引（`TermIndex`）で探す**。名前の広げ方（「マルキオ・イークェス」→
 *   「マルキオ」も）も本体の `expandNameVariants`。索引を2つに分けると、色が付く語が本体と食い違う
 * - 色は**本体の `TERM_COLORS`** から CSS の変数へ入れる（16進をこちらへ写さない。`termColorCss`）
 * - B は字を1字ずつ描くので、用語の字の span に種類のクラスを付ける（`renderPaneHtml` の `terms`）
 * - A は本体の原稿エディターと同じく、CSS Custom Highlight API で色を置く（DOM を書き換えない。
 *   書き換えると変換中の字とカーソルが飛ぶ）。`editableText.ts`
 *
 * **語の出どころ**：モバイル版はまだ作品の設定資料（人物・場所・能力・組織）を読んでいないので、
 * 試しの画面では作者が語を打つ（`TermInput`）。作品を開けるようになったら、本体と同じく設定資料から作る。
 *
 * ここは DOM に触らない（テストのため）。
 */

export const TERM_KINDS: readonly TermKind[] = ["character", "location", "ability", "organization"];

/** 種類の見出し（試しの画面の欄の名前） */
export const TERM_KIND_LABELS: Record<TermKind, string> = {
  character: "人物",
  location: "場所",
  ability: "能力",
  organization: "組織",
};

/** 試しの画面で作者が打つ語（種類ごとに、読点・カンマ・改行で区切る） */
export type TermInput = Record<TermKind, string>;

/** 初めて開いたときの語（見本の文に出てくる語） */
export const SAMPLE_TERM_INPUT: TermInput = {
  character: "吾輩",
  location: "",
  ability: "",
  organization: "",
};

/** 本文の中の用語1つ（UTF-16 の位置。`[start, end)`） */
export interface TermSpan {
  start: number;
  end: number;
  kind: TermKind;
}

/** 打った語を、本体と同じ形の索引の見出しへ */
export function termEntriesFrom(input: TermInput): TermEntry[] {
  const entries: TermEntry[] = [];
  for (const kind of TERM_KINDS) {
    const names = input[kind].split(/[、,，\n]/).map((s) => s.trim()).filter(Boolean);
    names.forEach((name, n) => {
      const id = `${kind}-${n}`;
      for (const text of expandNameVariants([name])) {
        entries.push({ text, kind, id, canonicalName: name });
      }
    });
  }
  return entries;
}

export function buildTermIndex(input: TermInput): TermIndex {
  return new TermIndex(termEntriesFrom(input));
}

/** 本文の中の用語（前から順。重なりは本体と同じく最左最長で1つに） */
export function findTermSpans(index: TermIndex, text: string): TermSpan[] {
  return index.find(text).map((m) => ({ start: m.start, end: m.end, kind: m.entry.kind }));
}

/**
 * 種類ごとの色を CSS の変数にする（明るい画面・暗い画面の両方）。
 * 本体の `TERM_COLORS` から作るので、色を直すときは本体の1か所だけでよい
 */
export function termColorCss(): string {
  const light = TERM_KINDS.map((k) => `--term-${k}: ${TERM_COLORS[k].light};`).join(" ");
  const dark = TERM_KINDS.map((k) => `--term-${k}: ${TERM_COLORS[k].dark};`).join(" ");
  const rules = TERM_KINDS.map(
    (k) => `.term-${k} { color: var(--term-${k}); } ::highlight(term-${k}) { color: var(--term-${k}); }`
  ).join("\n");
  return `:root { ${light} }\n@media (prefers-color-scheme: dark) { :root { ${dark} } }\n${rules}`;
}
