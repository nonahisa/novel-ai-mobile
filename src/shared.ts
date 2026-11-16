/**
 * 本体（統合小説執筆環境の VS Code 拡張機能）と共有する部品の入口。
 *
 * **画面のコードは本体の部品をここから取る。** 本体のファイルを直に
 * あちこちから import すると、どの部品に頼っているかが散らばり、
 * 本体の版を上げたときに確かめる範囲が分からなくなる。
 *
 * 取り込み方は `package.json` の `novel-ai-assistant`（本体のタグを指す依存）。
 * **いつも本体と同じ版で取り込む**（作者の裁定 2026-11-04。`docs/引継ぎ書.md` 2章）。
 * 共有の部品をこちらで直さない。
 */
export {
  parsePostingLedger,
  type PostingLedger,
} from "novel-ai-assistant/src/models/posting";
export {
  postingNotationTextHash,
  postingTextHash,
  postingBodyHash,
} from "novel-ai-assistant/src/core/postingBodyHash";
/*
  AI への通信。本体の `fetchJson` をそのまま使う。中で読む `./fetchTimeouts` は、
  組み立ての段でモバイル版の `src/platform/fetchTimeouts.ts` へ差し替わる（`substitutions.ts`）
*/
export { fetchJson, type JsonRequest } from "novel-ai-assistant/src/ai/httpClient";
export { AIError } from "novel-ai-assistant/src/ai/types";

/** 取り込んでいる本体の版（`vite.config.ts` が本体の package.json から埋める） */
export const SHARED_VERSION: string = __SHARED_VERSION__;

/*
  メニューの予定（設計書 4.4.1〜4.4.2）。「すべての機能」の名前は本体の詳細メニューと同じ字にする
  （相談の AI が名前で案内するため）ので、本体の木をそのまま読む
*/
export {
  ACTION_TREE,
  isItemShownInActionList,
  type ActionGroup,
  type ActionItem,
  type ActionSection,
} from "novel-ai-assistant/src/core/actionTree";
/* 縦書きの試し：ルビ・傍点の表示と字数は本体と同じ決まりで */
export {
  rubyToHtml,
  INTERNAL_RUBY_SOURCE,
  INTERNAL_EMPHASIS_SOURCE,
} from "novel-ai-assistant/src/core/ruby";
export { countChars, formatCount } from "novel-ai-assistant/src/core/charCount";
/* 作品ごとのメモの印（本体 1.0.1〜。.aiwriter/config.json の memoMarkers。読むのは platform/memoMarkers.ts） */
export {
  DEFAULT_MEMO_MARKERS,
  MemoMarkersConfigError,
  memoMarkersOf,
  memoMarkersOfConfigText,
  type MemoMarkers,
} from "novel-ai-assistant/src/core/memoMarkers";
/*
  用語の色付け：索引（Aho-Corasick）・名前の広げ方・種類ごとの色は本体と同じものを使う
  （本体の決まり「画面ごとに違う色にしない」「索引の作り方を2つに分けない」）
*/
export {
  TermIndex,
  expandNameVariants,
  type TermEntry,
  type TermKind,
  type TermMatch,
} from "novel-ai-assistant/src/core/termIndex";
export { TERM_COLORS, type TermColorPair } from "novel-ai-assistant/src/core/termColors";
/*
  作品一覧（A）と話の一覧（B）：作品の走査（本体の `core/scanner.ts`）は vscode に頼るので、
  走査が使う vscode に触らない部品を同じ順に通す（`platform/workScan.ts`）。写さない
*/
export {
  acceptManuscriptEntry,
  isKnownNonManuscript,
  resolveManuscriptDirAsync,
  MANUSCRIPT_TREE_DEPTH,
  type EntryKind,
  type Listing,
} from "novel-ai-assistant/src/core/manuscriptFolderRule";
export { parseEpisodeFileName } from "novel-ai-assistant/src/core/episodeParser";
export { parseEpisodeMetadata } from "novel-ai-assistant/src/core/metadataParser";
export { parseCollectedFile } from "novel-ai-assistant/src/core/collectedFile";
export { isWorkInfoFile } from "novel-ai-assistant/src/core/workInfoFile";
export { inferChapterHint, toChapterHintNote } from "novel-ai-assistant/src/core/episodeChapterHint";
export { containsConflictMarkers } from "novel-ai-assistant/src/core/mergeGuard";
export { countEpisodeChars, episodeBodyForCount } from "novel-ai-assistant/src/core/episodeCharCount";
export { addCounts, emptyCounts } from "novel-ai-assistant/src/core/charCount";
export { compareEpisodes } from "novel-ai-assistant/src/core/episodeOrder";
export { detectEol } from "novel-ai-assistant/src/core/eolAudit";
export { decodeBytes } from "novel-ai-assistant/src/core/textDecode";
export { parsePlotMarkdown } from "novel-ai-assistant/src/core/plotDoc";
export { matchWorkFormat, type WorkFormatKey } from "novel-ai-assistant/src/core/workFormat";
export { CHAPTERS_FILE, parseChapterSet, type Chapter } from "novel-ai-assistant/src/models/chapter";
export { groupEpisodesByChapter, type ChapterGrouping } from "novel-ai-assistant/src/core/chapterGrouping";
export { episodeTitle, formatChapterLabel, episodeListLabel, isCollectedFile } from "novel-ai-assistant/src/core/episodeLabel";
export {
  AIWRITER_DIR,
  CONFIG_FILE,
  DEFAULT_MANUSCRIPT_DIR,
  DEFAULT_SETTINGS_DIR,
  PLOT_FILE,
  type CharCounts,
  type EpisodeFile,
} from "novel-ai-assistant/src/models/types";
// 話の一覧の印：話数の重複・欠番（本体の作品一覧と同じ点検）と、校閲中の鍵（引継ぎ書 69章）
export { checkWorkEpisodeNumbers, workEpisodeNumberMarks, type WorkEpisodeNumberReport } from "novel-ai-assistant/src/core/episodeNumberCheck";
export { episodeUnit } from "novel-ai-assistant/src/core/episodeLabel";
export { parseLockEvents, resolveLocks, lockOf, type FileLock } from "novel-ai-assistant/src/models/fileLock";
// クラウドの AI の鍵の形の確かめ（本体と同じ。引継ぎ書 71章）
export { validateApiKeyFormat } from "novel-ai-assistant/src/ai/types";
