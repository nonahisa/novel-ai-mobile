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
  MEMO_MARKER_DEFS,
  MEMO_MARKER_IDS,
  memoMarkerLabels,
  memoMarkersOf,
  memoMarkersOfConfigText,
  sameMemoMarkers,
  type MemoMarkerId,
  type MemoMarkers,
} from "novel-ai-assistant/src/core/memoMarkers";
/* 作品の設定（作品の長押し → 作品の設定。2026-11-21 作者の答え「形式・ジャンルも」）：作品の種類の定義と、メモの印を切り替える前に数える行 */
export { WORK_KINDS, parseWorkKind, resolveWorkKind, workKindDef, type WorkKindKey } from "novel-ai-assistant/src/core/workKind";
export { linesStartingWithMarkers } from "novel-ai-assistant/src/core/sceneMemo";
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
// シリーズでつないだ作品の語（本体の設計書 6.95.3）：関門と config の読み方は本体と同じものを使う
export { isPlainFolderName, isShareableRecord, parseSeriesConfig, seriesSourceTitle } from "novel-ai-assistant/src/core/seriesLink";
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
export { nextChapterNumber, nextDatedName, nextUntitledName, parseEpisodeFileName, sanitizeFileName } from "novel-ai-assistant/src/core/episodeParser";
/*
  話の名前を変えたとき、パスで話を指す台帳を付け替える決まり（本体 1.0.38〜。`core/episodeRenumber.ts` が vscode を読まなくなった。
  サブタイトル案でファイル名を変える：2026-11-21 作者の答え「パソコンと同じにする」。`platform/episodeRename.ts`）
*/
export { renameUnnumberedSynopses, renumberBookPositions, renumberChapterSet, renumberPostingPosts, renumberTimelineEpisodes } from "novel-ai-assistant/src/core/episodeRenumber";
export { READINGS_DIRECTORY, readingDictionaryMoveConflictMessage } from "novel-ai-assistant/src/core/readingDictionaryPlace";
export { readingDictionaryFileName } from "novel-ai-assistant/src/core/readingDictionary";
export { normalizeEpisodePath } from "novel-ai-assistant/src/models/chapter";
export { BOOK_DIR, BOOK_FILE, BOOK_SCHEMA_VERSION } from "novel-ai-assistant/src/models/book";
export { POSTING_FILE, POSTING_SCHEMA_VERSION } from "novel-ai-assistant/src/models/posting";
export { TIMELINE_SCHEMA_VERSION } from "novel-ai-assistant/src/models/timeline";
export { findLatestEpisode } from "novel-ai-assistant/src/core/latestEpisode";
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
export { parsePlotMarkdown, updatePlotMarkdown, type PlotSections } from "novel-ai-assistant/src/core/plotDoc";
export { matchWorkFormat, selectableWorkFormats, suggestWorkFormat, type WorkFormatDef, type WorkFormatKey } from "novel-ai-assistant/src/core/workFormat";
/* 形式・ジャンル（作品の設定。本体の `features/setPlotBasics.ts`）：投稿先ごとのジャンル体系 */
export { GENRE_SITES, formatGenres, listGenres, type GenreChoice, type GenreSite } from "novel-ai-assistant/src/core/genre";
export { CHAPTERS_FILE, CHAPTERS_SCHEMA_VERSION, assertUniqueStarts, findChapterStartingAt, parseChapterSet, withChapterStartingAt, type Chapter, type ChapterSet } from "novel-ai-assistant/src/models/chapter";
export { groupEpisodesByChapter, type ChapterGrouping } from "novel-ai-assistant/src/core/chapterGrouping";
export { episodeTitle, formatChapterLabel, episodeListLabel, isCollectedFile } from "novel-ai-assistant/src/core/episodeLabel";
export {
  AIWRITER_DIR,
  CONFIG_FILE,
  CONFIG_SCHEMA_VERSION,
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
// 有料の AI へ送る前の確認の文言（本体のまま）と、手元の AI かの判定（引継ぎ書 72章）
export { paidUsageNotice, type PaidUsageNotice, type PaidUsageNoticeOptions } from "novel-ai-assistant/src/core/paidUsageNotice";
export { isLocalProviderId } from "novel-ai-assistant/src/core/localProviders";
// 機能ごとの AI の割り当て（本体 1.0.20 で vscode に頼らない部品に切り出された。引継ぎ書 74章）
export {
  ASSIGNABLE_FEATURES,
  ASSIGNABLE_FEATURE_LABELS,
  decideFeatureAI,
  withAssignment,
  withoutAssignment,
  type AssignableFeature,
  type FeatureAssignment,
  type FeatureAssignments,
} from "novel-ai-assistant/src/core/featureAssignment";

/* 設定資料の1件を読む（用語の色の語を作る。設計書 5.7。本体の views/termHighlight.ts の load と同じ語の作り方は platform/workTerms.ts） */
export { parseCharacter, type Character } from "novel-ai-assistant/src/models/character";
export { parseAbility, type Ability } from "novel-ai-assistant/src/models/ability";
export { parseLocation, type Location } from "novel-ai-assistant/src/models/location";
export { parseOrganization, type Organization } from "novel-ai-assistant/src/models/organization";

/*
  誤字脱字（段2。設計書 7章）：区切り・行番号・頼みの文・答えの読み方と確かめ・当て方は本体と同じものを使う。
  AI への頼みの部品（本体の ai/*Provider.ts）は vscode に頼るので借りられない（`platform/typoCheck.ts` で写す）
*/
export { withLineNumbers, locateChunkLine, type Chunk } from "novel-ai-assistant/src/core/chunker";
export { chunksOfEpisodeFile } from "novel-ai-assistant/src/core/episodeChunks";
export {
  buildTypoCheckPrompt,
  TYPO_CHECK_SCHEMA,
  TYPO_CHECK_SYSTEM_PROMPT,
  TYPO_CHECK_TEMPERATURE,
  TYPO_DICTIONARY_LIMIT,
} from "novel-ai-assistant/src/prompts/typoCheck";
export { parseTypoCheckResult, validateTypoIssues, looksArchaicText, type AcceptedTypoIssue } from "novel-ai-assistant/src/core/typoCheckValidation";
export { applyFindingToText } from "novel-ai-assistant/src/core/findingApply";
export { toOpenAIJsonSchema, toGeminiSchema } from "novel-ai-assistant/src/ai/jsonSchema";
// 推敲（段2。2026-11-18）：頼みの文・スキーマ・答えの読み方と確かめ・作品の作法・直さない語
export {
  buildProofreadPrompt,
  issueBudget,
  PROOFREAD_SCHEMA,
  PROOFREAD_SYSTEM_PROMPT,
  PROOFREAD_TEMPERATURE,
} from "novel-ai-assistant/src/prompts/proofread";
export {
  parseProofreadResult,
  validateProofreadIssues,
  locateProofreadIssue,
  sortProofreadIssues,
  type AcceptedProofreadIssue,
} from "novel-ai-assistant/src/core/proofreadValidation";
export { collectWorkStyle, buildStyleNote } from "novel-ai-assistant/src/core/workStyleFacts";
export { parseKeepWordSet, type KeepWord } from "novel-ai-assistant/src/models/keepWord";
// 各話あらすじ（段2。2026-11-18）：台帳の形・差し込み・頼みの文・答えの確かめ・本文の分け方とハッシュ
export {
  SYNOPSIS_SCHEMA_VERSION,
  dedupeSynopsisEpisodes,
  emptySynopsisSet,
  findSynopsis,
  parseSynopsisSet,
  upsertSynopsis,
  type ChapterSynopsis,
  type ChapterSynopsisSet,
} from "novel-ai-assistant/src/models/synopsis";
export {
  SYNOPSIS_SCHEMA,
  SYNOPSIS_SYSTEM_PROMPT,
  SYNOPSIS_TEMPERATURE,
  buildSynopsisPrompt,
  synopsisPromptVersion,
  type SubtitleSuggestion,
} from "novel-ai-assistant/src/prompts/synopsis";
export { parseSynopsisResult, validateSynopsisResult } from "novel-ai-assistant/src/core/synopsisValidation";
export { splitEpisodeBodyParts } from "novel-ai-assistant/src/core/episodeBodyParts";
export { decodeByteFallback } from "novel-ai-assistant/src/core/byteFallback";
// 作品の題を変える（作品の長押し。2026-11-18）：設定ファイルの改行の形を読んだまま書く
export { detectJsonFileFormat, formatJsonForFile } from "novel-ai-assistant/src/core/jsonFileFormat";
// 執筆統計（I。2026-11-19）：字数の言い方だけ本体から。記録の読み方は `platform/writingStatsRead.ts`
// （本体の core/writingStats.ts は型を `import type` で読まず、このアプリの型検査〈verbatimModuleSyntax〉を通らない）
export { describeWrittenAmount } from "novel-ai-assistant/src/core/writingAmountText";
// ［…］→ 書き出し（2026-11-19 夜 作者の決定「投稿サイト向けの本文を写す」）：本体の「コピー（投稿サイト用）」と同じ変換
export { convertForPosting, noteCopyMessage } from "novel-ai-assistant/src/core/postingConvert";
export { postingCopyTargets, type PostingCopyTarget } from "novel-ai-assistant/src/core/postingCopyTargets";
export { postingCopySource } from "novel-ai-assistant/src/core/episodeCopy";
/*
  横の板の「校正・メモ」（2026-11-20 夜 作者の答え「本体と同じく位置の順に1列」）：付箋の拾い方と、
  編集者の提案と決定の突き合わせは本体と同じものを使う（`app/noteBoard.ts`・`platform/editorProposals.ts`）
*/
export { parseMemos, type SceneMemo } from "novel-ai-assistant/src/core/sceneMemo";
export { resolveProposals, type ProposalLine, type ProposalView } from "novel-ai-assistant/src/models/proposal";
