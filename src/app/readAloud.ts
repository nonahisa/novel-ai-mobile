import { buildReadingPlan, notationModeFor, readingRangesOf, type MemoMarkers, type ReadingSentence } from "../shared";
import type { SpeakEnd, Speaker } from "../platform/speech";

/**
 * **［…］→ 読み上げ**（本体の設計書 6.42 音読推敲。2026-11-27 モバイル版の最初の一切り）。
 *
 * - 文の区切り・声に渡す写し（ルビは読み・傍点は中身・付箋の行は読まない・頭の欄は読まない）は本体の
 *   `buildReadingPlan` をそのまま使う。本文は1字も変えない
 * - 記法は本体と同じく、ファイルの名前で決める（`.md` は `{漢字|かんじ}`、ほかは投稿サイトの書き方。`notationModeFor`）
 * - 読み始めはカーソルのある文。カーソルが読む範囲の外（頭の欄）なら最初の文（題）から（本体の `aloudIndexAt` と同じ）。
 *   カーソルが末尾なら頭から
 * - 止めるのは［止める］だけ（一時停止は無い。本体も pause を使わない）
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
