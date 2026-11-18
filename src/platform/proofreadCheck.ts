import {
  PROOFREAD_SCHEMA,
  PROOFREAD_SYSTEM_PROMPT,
  PROOFREAD_TEMPERATURE,
  buildProofreadPrompt,
  buildStyleNote,
  collectWorkStyle,
  issueBudget,
  locateProofreadIssue,
  looksArchaicText,
  parseKeepWordSet,
  parseProofreadResult,
  sortProofreadIssues,
  validateProofreadIssues,
  withLineNumbers,
  type KeepWord,
  type MemoMarkers,
} from "../shared";
import { FileNotFoundError, joinStorePath, type FileStore } from "./fileStore";
import { typoCheckChunks, type ModelCall, type TypoCheckFailure } from "./typoCheck";

/**
 * **推敲**（段2。2026-11-18。設計書 7章）。1話の本文を区切って AI に見せ、読みにくい所だけの指摘を返す。
 *
 * 頼みの文・スキーマ・答えの読み方と確かめ（上限・観点・修正案の検算）・行の戻し方は本体と同じ部品（`shared.ts`）。
 * 本体の流れ（`features/checkProofread.ts`）は vscode に頼るので、誤字脱字（`typoCheck.ts`）と同じ順に並べ直す。
 *
 * 本体と違うところ（モバイル版では、まだ写していない）：
 * - 語り手の名前が地の文に出る所をコードが数えて並べる（本体の `findNarratorSlipsInSources`。人物の資料を読む）
 * - 人称（プロットの「人称」）を読む。作法は本文から数えた一人称・文語かと、直さない語から作る
 * - 区切りは誤字脱字と同じ大きさ（8000字）。本体はモデルの読める長さから決める
 *
 * **AI の答えは信用しない**（本体の決まり3）。**失敗は「0件」にしない**（区切りごとの失敗として返す）
 */

export interface ProofreadFinding {
  path: string;
  line: number;
  original: string;
  /** 置き換える範囲。推敲では原文まるごと */
  target: string;
  /** 修正案。語尾単調・視点・長文などは空（直し方は作者に任せる） */
  suggestion: string;
  /** 観点（冗長・同語反復・係り受け・長文・漢字ひらき・語尾単調・視点） */
  reason: string;
  /** どの語がどう読みにくいか */
  explanation: string;
  confidence: "high" | "medium" | "low";
}

export interface ProofreadResult {
  findings: ProofreadFinding[];
  failures: TypoCheckFailure[];
  calls: number;
  rejected: number;
}

export interface ProofreadInput {
  path: string;
  /** 話の本文（改行は LF） */
  text: string;
  memoMarkers: MemoMarkers;
  /** 作者が「直さない」と決めた語（`設定/keep_words.json`） */
  keepWords: readonly KeepWord[];
}

/** 作者が「直さない」と決めた語（本体の `KeepWordStore` と同じ置き場。無い・壊れていれば空） */
export const KEEP_WORDS_FILE = "keep_words.json";
export async function readKeepWords(store: FileStore, settingsDir: string): Promise<KeepWord[]> {
  try {
    const raw = new TextDecoder().decode(await store.readFile(joinStorePath(settingsDir, KEEP_WORDS_FILE)));
    return parseKeepWordSet(JSON.parse(raw)).words;
  } catch (error) {
    // 無いのがふつう。壊れていても推敲は止めない（直さない語を守れないだけ。作者の資料は書き換えない）
    if (error instanceof FileNotFoundError) return [];
    return [];
  }
}

export async function checkEpisodeProofread(input: ProofreadInput, call: ModelCall, signal?: AbortSignal): Promise<ProofreadResult> {
  const chunks = typoCheckChunks({ path: input.path, text: input.text, memoMarkers: input.memoMarkers, properNouns: [] });
  const keepWords = [...input.keepWords];
  const archaic = looksArchaicText(input.text);
  const styleNote = buildStyleNote(collectWorkStyle({ bodyText: input.text, narrativePerson: "", keepWords: keepWords.map((entry) => entry.word) }));
  const result: ProofreadResult = { findings: [], failures: [], calls: 0, rejected: 0 };
  const accepted: ProofreadFinding[] = [];
  for (const [index, chunk] of chunks.entries()) {
    if (signal?.aborted) break;
    const user = buildProofreadPrompt({
      chunkTextWithLineNumbers: withLineNumbers(chunk),
      narrativeStyle: "",
      styleNote,
      maxIssues: issueBudget(chunk.text.length),
    });
    let text: string;
    try {
      result.calls++;
      text = await call({ system: PROOFREAD_SYSTEM_PROMPT, user, schema: PROOFREAD_SCHEMA, temperature: PROOFREAD_TEMPERATURE, signal });
    } catch (error) {
      if (signal?.aborted) break;
      result.failures.push({ chunk: index + 1, reason: error instanceof Error ? error.message : String(error) });
      continue;
    }
    const parsed = parseProofreadResult(text);
    if (!parsed) {
      result.failures.push({ chunk: index + 1, reason: "AI の答えが読めませんでした" });
      continue;
    }
    const checked = validateProofreadIssues(parsed, chunk, keepWords, null, archaic);
    result.rejected += checked.rejected.length;
    for (const issue of checked.accepted) {
      const at = locateProofreadIssue(chunk, issue);
      if (!at) {
        result.rejected++;
        continue;
      }
      accepted.push({
        path: input.path,
        line: at.line,
        original: at.original,
        target: at.target,
        suggestion: at.suggestion,
        reason: at.reason,
        explanation: at.explanation,
        confidence: at.confidence,
      });
    }
  }
  // 確信度の高いものを先に（本体と同じ）
  result.findings = sortProofreadIssues(accepted as never) as unknown as ProofreadFinding[];
  return result;
}
