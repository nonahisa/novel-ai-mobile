import { convertForPosting, noteCopyMessage, postingCopySource, postingCopyTargets, type PostingCopyTarget } from "../shared";
import type { MemoMarkers } from "../shared";

/**
 * **［…］→ 書き出し：投稿サイト向けの本文を写す**（2026-11-19 夜 作者の決定、案1。設計書 4.4「上のバーの［…］：
 * 作品と話の操作（新しい話・章を立てる・書き出し・AI を走らせる）」）。
 *
 * 本体の「コピー（投稿サイト用）」と同じ変換を通す（`postingCopySource` で写す元を決め、`convertForPosting` で
 * 貼り付け先の書き方へ。設計書 6.84・6.12.8）。スマホから投稿サイトの入力欄へ貼るのに使う。
 *
 * - 範囲を選んでいればそこだけ。選んでいなければ話ぜんぶ（頭書きを外し、前後の空行を詰める。合本ならカーソルの話）
 * - 付箋の行（作品のメモの印）は落とす（本体と同じ。変換の中で落とす）
 * - 貼り付け先は本体と同じ一覧（サイトの名前で選ぶ。投稿の台帳はまだ読まないので、並びは既定のまま）
 */
export function exportTargets(): PostingCopyTarget[] {
  return postingCopyTargets([]);
}

export interface ExportResult {
  /** 写しに入れるもの */
  text: string;
  /** 写したあとの知らせ */
  message: string;
}

/** 写すものと知らせを作る */
export function exportCopy(
  fullText: string,
  selection: { start: number; end: number },
  target: PostingCopyTarget,
  memoMarkers?: MemoMarkers
): ExportResult {
  const caretLine = fullText.slice(0, selection.start).split("\n").length;
  const selectedText = selection.end > selection.start ? fullText.slice(selection.start, selection.end) : undefined;
  const { source, selected } = postingCopySource(fullText, caretLine, selectedText);
  const converted = convertForPosting(source, target, { trimEdges: !selected, ...(memoMarkers ? { memoMarkers } : {}) });
  const length = [...converted.text].length;
  const message = converted.note
    ? noteCopyMessage(converted.note, length)
    : `${target.label}向けに${selected ? "選んだところを" : ""}コピーしました（${length.toLocaleString("ja-JP")}字）`;
  return { text: converted.text, message };
}
