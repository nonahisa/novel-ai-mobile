import {
  buildReadingPlan,
  DEFAULT_MEMO_MARKERS,
  isReadingMemoLine,
  memoInsertOf,
  notationModeFor,
  READ_ALOUD_MEMO_TEXT,
  readingRangesOf,
  type MemoMarkers,
  type ReadingSentence,
} from "../shared";
import type { SpeakEnd, Speaker } from "../platform/speech";

/**
 * **［…］→ 読み上げ**（本体の設計書 6.42 音読推敲。2026-11-27 モバイル版の最初の一切り）。
 *
 * - 文の区切り・声に渡す写し（ルビは読み・傍点は中身・付箋の行は読まない・頭の欄は読まない）は本体の
 *   `buildReadingPlan` をそのまま使う。本文は1字も変えない
 * - 記法は本体と同じく、ファイルの名前で決める（`.md` は `{漢字|かんじ}`、ほかは投稿サイトの書き方。`notationModeFor`）
 * - 読み始めはカーソルのある文。カーソルが読む範囲の外（頭の欄）なら最初の文（題）から（本体の `aloudIndexAt` と同じ）。
 *   カーソルが末尾なら頭から
 * - 止めるのは［止める］。［⚑ 引っかかった］を押すと、その文の上に付箋の行を挿して一時停止し、［続ける］で同じ文から読む
 */
export interface AloudPlan {
  sentences: ReadingSentence[];
  readable: { start: number; end: number }[] | null;
}

export function readingPlanFor(text: string, path: string, memoMarkers?: MemoMarkers): AloudPlan {
  return {
    sentences: buildReadingPlan(text, notationModeFor(path), [], memoMarkers ? { memoMarkers } : {}),
    readable: readingRangesOf(text),
  };
}

export function aloudStartIndex(plan: AloudPlan, caret: number): number {
  if (plan.readable && !plan.readable.some((range) => caret >= range.start && caret <= range.end)) return 0;
  const index = plan.sentences.findIndex((sentence) => sentence.end > caret);
  return index < 0 ? 0 : index;
}

/**
 * ［⚑ 引っかかった］で挿す行（本体の `insertReadingMemo`・設計書 6.42）。`line` は文の行（1始まり）で、その行の頭に挿す。
 * 印は作品のメモの印（`//` を外した作品ではオンの印のうち最初のもの。既定の `// ` で挿すと本文の行になる）。
 * **直前の行がもう同じ印なら挿さない**（止めて続けたあと同じ文でもう一度押すと、同じ行が2つ入る。本体の不具合 2026-10-17）
 */
export type ReadingMemoEdit = { kind: "insert"; at: number; insert: string } | { kind: "already" };

export function readingMemoEdit(text: string, line: number, markers: MemoMarkers = DEFAULT_MEMO_MARKERS): ReadingMemoEdit {
  // 欄の本文（textarea の値）の改行はいつも LF（CRLF の原稿も欄では LF。書き戻すときに戻す）
  const lines = text.split("\n");
  const index = Math.min(Math.max((Number.isFinite(line) ? line : 1) - 1, 0), Math.max(lines.length - 1, 0));
  if (index > 0 && isReadingMemoLine(lines[index - 1]!, markers)) return { kind: "already" };
  const at = lines.slice(0, index).reduce((sum, row) => sum + row.length + 1, 0);
  const insert = memoInsertOf(markers);
  return { kind: "insert", at, insert: `${insert.prefix}${READ_ALOUD_MEMO_TEXT}${insert.suffix}\n` };
}

/** 一時停止のあと［続ける］で読む文：本文の `offset` を含む（またはその後の）最初の文。無ければ頭から */
export function resumeIndexAt(plan: AloudPlan, offset: number): number {
  const index = plan.sentences.findIndex((sentence) => sentence.end > offset);
  return index < 0 ? 0 : index;
}

export interface AloudRun {
  finished: Promise<SpeakEnd>;
  stop(): void;
}

/** `from` の文から順に読む。読み始める文ごとに `onSentence` */
export function runAloud(
  speaker: Speaker,
  plan: AloudPlan,
  from: number,
  options: { rate: number; onSentence: (index: number, sentence: ReadingSentence) => void }
): AloudRun {
  let stopped = false;
  const finished = (async (): Promise<SpeakEnd> => {
    for (let index = from; index < plan.sentences.length; index++) {
      if (stopped) return "stopped";
      const sentence = plan.sentences[index]!;
      options.onSentence(index, sentence);
      const end = await speaker.speak(sentence.speech, options.rate);
      if (stopped || end === "stopped") return "stopped";
    }
    return "done";
  })();
  return {
    finished,
    stop() {
      stopped = true;
      speaker.stop();
    },
  };
}
