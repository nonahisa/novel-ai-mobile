import { applyFindingToText, containsConflictMarkers } from "../shared";
import type { FileStore } from "./fileStore";
import { readTextFile, writeTextFilePreservingFormat, type WriteTextFailureReason } from "./textFile";
import type { TypoFinding } from "./typoCheck";

/**
 * **採った指摘を本文へ当てる**（段2。設計書 7章）。本文の書き戻しは必ず `writeTextFilePreservingFormat` を通す
 * （本体の決まり1：ハッシュの照らし合わせ・文字コードと改行の保持・退避・競合の印のある本文は書かない）。
 * 指摘を出したあとに本文が変わり、元の行や直す字が見つからなければ当てない（無理に当てない）。
 * 書く直前に `beforeWrite` を呼ぶ（アプリが書いた話の控え。送り漏れを防ぐ。引継ぎ書 61章）
 */

export type ApplyOutcome =
  | { kind: "applied" }
  | { kind: "stale" }
  | { kind: "conflict" }
  | { kind: "failed"; reason: WriteTextFailureReason | "read_failed"; detail?: string };

/**
 * 退避は話ごとに最初の1回だけ（設計書 5.4 と同じ考え）。指摘を採るたびに退避すると、5世代がすぐに埋まり、
 * AI に見せる前の本文が押し出される。アプリを開き直すと、また最初の1回から
 */
const backedUp = new Set<string>();

export async function applyProposal(store: FileStore, finding: TypoFinding, beforeWrite?: (path: string) => Promise<void>): Promise<ApplyOutcome> {
  let content;
  try {
    content = await readTextFile(store, finding.path);
  } catch {
    return { kind: "failed", reason: "read_failed" };
  }
  if (containsConflictMarkers(content.text)) return { kind: "conflict" };
  // 当てる部品は LF の本文で行を数える。書くときに元の改行へ戻す（`writeTextFilePreservingFormat`）
  const lf = content.text.replace(/\r\n?/g, "\n");
  const applied = applyFindingToText(lf, finding);
  if (applied.kind !== "applied") return { kind: "stale" };
  if (beforeWrite) await beforeWrite(finding.path);
  const written = await writeTextFilePreservingFormat(store, finding.path, applied.text, content, content.hash, { skipRecovery: backedUp.has(finding.path) });
  if (written.ok) backedUp.add(finding.path);
  if (!written.ok) return { kind: "failed", reason: written.reason, ...(written.detail !== undefined ? { detail: written.detail } : {}) };
  return { kind: "applied" };
}

/** 作者に出す一言 */
export function applyOutcomeText(outcome: ApplyOutcome): string {
  switch (outcome.kind) {
    case "applied":
      return "本文を直しました";
    case "stale":
      return "本文が変わっていて、直す所が見つかりません。この指摘は外しました";
    case "conflict":
      return "競合が残っている話には当てません";
    case "failed":
      return outcome.reason === "modified_externally" ? "読んだあとで本文が変わったので、当てませんでした" : "本文を書けませんでした";
  }
}
