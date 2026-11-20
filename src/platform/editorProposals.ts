import { resolveProposals, type ProposalLine, type ProposalView } from "../shared";
import { FileNotFoundError, joinStorePath, type FileStore } from "./fileStore";

/**
 * **編集者の提案（`.aiwriter/proposals.jsonl`）のうち、まだ決めていないものを読む**（横の板の「校正・メモ」。
 * 2026-11-20 夜 作者の答え。本体の設計書 6.96.5「編集者の提案も校正・メモへ」）。
 *
 * - 台帳は本体が書く（1行1件。提案の行と、採った・見送った・読んだの行）。ここは読むだけで、書かない
 * - 行の読み方は本体の `core/proposalStore.ts` の `parseProposalLines` と同じ決まり（あちらは vscode に頼るので取り込めない）：
 *   読めない行・競合の印の行は捨て、読める行は残す。どこを直すか分からない提案（番号・ファイル・直す所が無い）は捨てる
 * - 提案と決定の突き合わせは本体の `resolveProposals` をそのまま使う（後から来た決定が勝つ）
 */
export const EDITOR_PROPOSALS_PATH = ".aiwriter/proposals.jsonl";

const text = (value: unknown): string => (typeof value === "string" ? value : "");

function toLine(value: unknown): ProposalLine | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as Record<string, unknown>;
  if (record.kind === "proposal") {
    const id = text(record.id);
    const file = text(record.file);
    const target = text(record.target);
    if (!id || !file || !target) return undefined;
    return {
      kind: "proposal",
      id,
      time: text(record.time),
      proposer: text(record.proposer),
      file,
      line: typeof record.line === "number" ? record.line : 0,
      original: text(record.original),
      target,
      suggestion: text(record.suggestion),
      reason: text(record.reason),
      category: text(record.category),
    };
  }
  if (record.kind === "decision") {
    const proposalId = text(record.proposalId);
    const status = record.status;
    if (!proposalId || (status !== "accepted" && status !== "rejected" && status !== "read")) return undefined;
    return { kind: "decision", proposalId, time: text(record.time), decidedBy: text(record.decidedBy), status, note: text(record.note) };
  }
  return undefined;
}

export function parseEditorProposalLines(source: string): ProposalLine[] {
  const lines: ProposalLine[] = [];
  for (const raw of source.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || /^(<<<<<<<|=======|>>>>>>>)/.test(line)) continue;
    try {
      const parsed = toLine(JSON.parse(line));
      if (parsed) lines.push(parsed);
    } catch {
      // 壊れた行は捨てる
    }
  }
  return lines;
}

/** 台帳の中身から、`file`（作品フォルダーからの相対パス）のまだ決めていない提案を */
export function pendingEditorProposals(source: string, file: string): ProposalView[] {
  return resolveProposals(parseEditorProposalLines(source)).filter((view) => view.status === "pending" && view.file === file);
}

/** 作品の台帳を読む。無ければ・読めなければ空（板に出ないだけ） */
export async function readPendingEditorProposals(store: FileStore, workRoot: string, file: string): Promise<ProposalView[]> {
  try {
    const bytes = await store.readFile(joinStorePath(workRoot, EDITOR_PROPOSALS_PATH));
    return pendingEditorProposals(new TextDecoder().decode(bytes), file);
  } catch (error) {
    if (error instanceof FileNotFoundError) return [];
    return [];
  }
}
