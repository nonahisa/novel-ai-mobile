import { AIWRITER_DIR, parseReadingDictionary, READINGS_DIRECTORY, readingDictionaryFileName, readingSpansFor, type ReadingSpan } from "../shared";
import { joinStorePath, type FileStore } from "./fileStore";

/**
 * **読みの辞書を読み上げに当てる**（本体の設計書 6.42.1。本体の `readingDictionarySummary` の範囲の所）。
 *
 * パソコンで作った・直した話ごとの辞書（`.aiwriter/readings/<話>.json`。同期で端末にも来る）を読み、声へ渡す写しだけを
 * その読みに替える範囲を返す。当て方（作者の項目が先・消した項目は当てない・同じ句なら何度でも）は本体の `readingSpansFor`。
 *
 * - **読むだけ**。端末では辞書を作らない・直さない（作るのは AI〔有料〕、直すのはパソコンの一覧）
 * - **失敗しても投げない**（本体と同じ）。辞書が無い・壊れている・形が違うときは空を返し、ふつうに読む。
 *   壊れた辞書を直したり空で上書きしたりはしない
 */
export async function readingSpansForEpisode(store: FileStore, workRoot: string, episodePath: string, text: string): Promise<ReadingSpan[]> {
  if (!episodePath.startsWith(`${workRoot}/`)) return [];
  const relative = episodePath.slice(workRoot.length + 1);
  try {
    const bytes = await store.readFile(joinStorePath(workRoot, AIWRITER_DIR, READINGS_DIRECTORY, readingDictionaryFileName(relative)));
    const file = parseReadingDictionary(new TextDecoder().decode(bytes).replace(/^﻿/, ""));
    return readingSpansFor(text, file.entries).spans;
  } catch {
    return [];
  }
}
