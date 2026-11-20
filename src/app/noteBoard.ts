import { escapeHtml } from "./menuScreen";
import { renderProposalItem, type TypoProposal } from "./typoProposals";
import type { ProposalView, SceneMemo } from "../shared";

/**
 * **横の板の「校正・メモ」**（2026-11-20 夜 作者の答え「本体と同じく位置の順に1列」。本体の設計書 6.40・6.96 の校正・メモパネル、
 * 並べ方は本体の `core/sceneMemoRows.ts` の `mergeNoteRows`）。
 *
 * 開いている話の、作者の付箋（本文の `//` などの行）・編集者の提案（`.aiwriter/proposals.jsonl` のまだ決めていないもの）・
 * AI の指摘（誤字脱字・推敲。端末の提案）を、**種類で分けず本文の行の順に1列に並べる**。同じ行なら、作者の付箋 → 編集者の提案 →
 * AI の指摘の順（本体と同じ：人が書いたものを先に読ませる）。同じ行・同じ種類は届いた順のまま。
 *
 * - 行を押すとその行の頭へ（付箋・編集者の提案・AI の指摘のどれも）
 * - AI の指摘は［採る］［見送る］（これまでどおり）
 * - 編集者の提案は見て飛ぶだけ。採る・見送るの記録（台帳へ書く）はまだ作っていない
 * - 置き場は分かれたまま（付箋は本文の中・指摘は端末・提案は台帳）。混ぜるのは画面の上だけ
 */
export type NoteRow =
  | { kind: "memo"; line: number; memo: SceneMemo }
  | { kind: "editor"; line: number; proposal: ProposalView }
  | { kind: "ai"; line: number; proposal: TypoProposal };

const RANK: Record<NoteRow["kind"], number> = { memo: 0, editor: 1, ai: 2 };

export function mergeNoteRows(memos: readonly SceneMemo[], editor: readonly ProposalView[], ai: readonly TypoProposal[]): NoteRow[] {
  const rows: NoteRow[] = [
    ...memos.map((memo): NoteRow => ({ kind: "memo", line: memo.line, memo })),
    ...editor.map((proposal): NoteRow => ({ kind: "editor", line: proposal.line, proposal })),
    ...ai.map((proposal): NoteRow => ({ kind: "ai", line: proposal.line, proposal })),
  ];
  // sort は同じ値の並びを保つ（届いた順が最後の決め手）
  return rows.sort((a, b) => a.line - b.line || RANK[a.kind] - RANK[b.kind]);
}

/** 編集者の提案の主文（本体の `proposalHeadline` と同じ形）：直す案があれば「直す所」→「案」、無ければ意見 */
export function editorHeadline(proposal: Pick<ProposalView, "target" | "suggestion" | "reason" | "original">): string {
  if (proposal.suggestion && proposal.target) return `「${proposal.target}」→「${proposal.suggestion}」`;
  return proposal.reason || proposal.original;
}

const attrs = (row: NoteRow) => ` data-note-kind="${row.kind}" data-note-line="${row.line}"`;

function renderRow(row: NoteRow): string {
  switch (row.kind) {
    case "ai":
      return renderProposalItem(row.proposal, attrs(row), "note-row proposal");
    case "memo": {
      const body = [row.memo.tag, row.memo.text].filter(Boolean).join("　");
      return `<li class="note-row note-memo"${attrs(row)}><p class="note-head"><span class="note-tag">付箋</span>${escapeHtml(body)}</p><p class="proposal-why">${row.line}行</p></li>`;
    }
    case "editor": {
      const headline = editorHeadline(row.proposal);
      const note = row.proposal.suggestion ? row.proposal.reason : "";
      return (
        `<li class="note-row note-editor"${attrs(row)}><p class="note-head"><span class="note-tag">編集者の提案</span>${escapeHtml(headline)}</p>` +
        `<p class="proposal-why">${escapeHtml(`${row.line}行${note && note !== headline ? `・${note}` : ""}`)}</p></li>`
      );
    }
  }
}

export function renderNoteBoard(rows: readonly NoteRow[]): string {
  if (rows.length === 0) return `<div class="proposal-list"><div class="work-empty" aria-hidden="true"></div></div>`;
  return `<ol class="proposal-list note-list">${rows.map(renderRow).join("")}</ol>`;
}
