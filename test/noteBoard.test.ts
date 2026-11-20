import { describe, expect, it } from "vitest";
import { editorHeadline, mergeNoteRows } from "../src/app/noteBoard";
import { pendingEditorProposals } from "../src/platform/editorProposals";
import type { TypoProposal } from "../src/app/typoProposals";
import type { ProposalView, SceneMemo } from "../src/shared";

/** 横の板の「校正・メモ」（2026-11-20 夜 作者の答え「本体と同じく位置の順に1列」） */
const memo = (line: number): SceneMemo => ({ filePath: "p", line, tag: "メモ", text: `付箋${line}`, raw: "" });
const ai = (line: number, id: string): TypoProposal => ({ root: "r", path: "p", id, line, original: "", target: "x", suggestion: "y", reason: "", confidence: "high" });
const editor = (line: number, id: string): ProposalView => ({ id, time: "", proposer: "", file: "本文/1.txt", line, original: "", target: "x", suggestion: "y", reason: "", category: "", status: "pending" });

describe("並べ方", () => {
  it("種類で分けず行の順。同じ行は 付箋 → 編集者の提案 → AI の指摘、同じ種類は届いた順", () => {
    const rows = mergeNoteRows([memo(3), memo(1)], [editor(1, "e1"), editor(2, "e2")], [ai(1, "a1"), ai(1, "a2"), ai(0, "a0")]);
    expect(rows.map((r) => `${r.kind}:${r.line}${r.kind === "memo" ? "" : `:${r.proposal.id}`}`)).toEqual(["ai:0:a0", "memo:1", "editor:1:e1", "ai:1:a1", "ai:1:a2", "editor:2:e2", "memo:3"]);
  });
  it("編集者の提案の主文：案があれば「直す所」→「案」、意見だけなら理由", () => {
    expect(editorHeadline({ target: "霧", suggestion: "靄", reason: "r", original: "o" })).toBe("「霧」→「靄」");
    expect(editorHeadline({ target: "霧", suggestion: "", reason: "ここは長い", original: "o" })).toBe("ここは長い");
  });
});

describe("編集者の提案の台帳", () => {
  const line = (over: Record<string, unknown>) => JSON.stringify({ kind: "proposal", id: "e1", time: "2026-11-20T10:00:00Z", file: "本文/1.txt", line: 2, target: "霧", suggestion: "靄", ...over });
  it("この話のまだ決めていないものだけ。壊れた行・競合の印・直す所の無い提案は捨てる。後の決定が勝つ", () => {
    const source = [
      line({}),
      line({ id: "e2" }),
      JSON.stringify({ kind: "decision", proposalId: "e2", time: "2026-11-20T11:00:00Z", status: "accepted" }),
      line({ id: "e3" }),
      JSON.stringify({ kind: "decision", proposalId: "e3", time: "2026-11-20T11:00:00Z", status: "rejected" }),
      line({ id: "other", file: "本文/2.txt" }),
      line({ id: "noTarget", target: "" }),
      "<<<<<<< ours",
      "{壊れた",
    ].join("\n");
    expect(pendingEditorProposals(source, "本文/1.txt").map((v) => v.id)).toEqual(["e1"]);
  });
});
