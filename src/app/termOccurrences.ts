import { TermIndex, type TermEntry } from "../shared";

/**
 * **名前が出る話と行**（設計書 5.7【決定】「資料の側からは、その名前が出る話と行を並べ、押すとその場所へ飛ぶ」）。
 *
 * 同じ資料（`id` が同じ語：名前と別名）が本文に出る所を、話の順・行の順に並べる。探すのは用語の色と同じ本体の
 * 索引（`TermIndex`）で、ほかの語も入れて探す——色と同じ最左最長にするため（「マルキオの灯台」の中の「マルキオ」は
 * 人物として数えない）。DOM にも置き場にも触らない
 */

export interface TermOccurrence {
  path: string;
  /** 行の番号（1から） */
  line: number;
  /** 本文の中の字の場所（飛んだ先でカーソルを置く所） */
  offset: number;
  /** 当たった字 */
  text: string;
  /** 行の抜き出し（前後を短く切る） */
  excerpt: string;
}

const BEFORE = 12;
const AFTER = 20;
export const OCCURRENCE_LIMIT = 50;

function excerptOf(line: string, start: number, end: number): string {
  const from = Math.max(0, start - BEFORE);
  const to = Math.min(line.length, end + AFTER);
  return `${from > 0 ? "…" : ""}${line.slice(from, to)}${to < line.length ? "…" : ""}`;
}

export function findTermOccurrences(
  entries: readonly TermEntry[],
  id: string,
  docs: readonly { path: string; text: string }[],
  limit = OCCURRENCE_LIMIT
): { hits: TermOccurrence[]; more: boolean } {
  const hits: TermOccurrence[] = [];
  if (!entries.some((e) => e.id === id)) return { hits, more: false };
  const index = new TermIndex([...entries]);
  for (const doc of docs) {
    let lineStart = 0;
    const lines = doc.text.split("\n");
    for (let n = 0; n < lines.length; n++) {
      const line = lines[n];
      for (const match of index.find(line)) {
        if (match.entry.id !== id) continue;
        if (hits.length >= limit) return { hits, more: true };
        hits.push({
          path: doc.path,
          line: n + 1,
          offset: lineStart + match.start,
          text: line.slice(match.start, match.end),
          excerpt: excerptOf(line, match.start, match.end),
        });
      }
      lineStart += line.length + 1;
    }
  }
  return { hits, more: false };
}
