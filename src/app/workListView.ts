import {
  episodeListLabel,
  episodeTitle,
  formatChapterLabel,
  formatCount,
  groupEpisodesByChapter,
  isCollectedFile,
  checkWorkEpisodeNumbers,
  episodeUnit,
  lockOf,
  workEpisodeNumberMarks,
  type EpisodeFile,
} from "../shared";
import { fromStorePath, toStorePath } from "../platform/paths";
import type { ScannedWork, WorkListItem } from "../platform/workScan";
import type { WorkSyncState } from "../platform/workSync";

/**
 * 作品一覧（A）と話の一覧（B）に出す中身（設計書 4.2）。画面の描き方は `workScreens.ts`、ここは何をどの順に出すかだけ。
 *
 * - 字数は本体の作品一覧の既定と同じ純文字数（`counts.net`。本体の `DEFAULT_COUNT_MODE`）
 * - 話の見出し・題は本体と同じ部品（`formatChapterLabel`・`episodeTitle`・`episodeListLabel`）
 * - 章の束ねは本体の `groupEpisodesByChapter`。章立てが無ければ章なしで並べる。並びは本体の作品一覧と同じ
 *   （話は `compareEpisodes` の順、最初の章より前の話を先に、開始の話が見つからない章は最後）
 */

/**
 * 本体の文の、パソコンの画面を指す言い回しを、モバイル版の言い方に置き換える
 * （2026-11-16 作者の答え「モバイル版の中で言い方を置き換える」）。
 * スマホには作品別設定の画面がまだ無いので、パソコンで直して同期してもらう
 */
const PC_WORDINGS: readonly [RegExp, string][] = [
  [/詳細メニューの作品別設定の「([^」]+)」で選び直すか、手で直してください/g, "パソコンで作品別設定の「$1」を選び直してから、同期してください"],
  [/詳細メニューの作品別設定/g, "パソコンの作品別設定"],
  [/(?<!パソコンの)詳細メニュー/g, "パソコンの詳細メニュー"],
];
export function mobileWording(text: string): string {
  return PC_WORDINGS.reduce((acc, [pattern, replacement]) => acc.replace(pattern, replacement), text);
}

/** 作品一覧の1枚 */
export interface WorkCard {
  root: string;
  title: string;
  /** 話数・字数・最後に書いた日。読めなかった作品では空 */
  meta: string[];
  /** 印（競合など） */
  flags: { text: string; tone: "shu" | "warn" }[];
}

export function workCard(item: WorkListItem, now: Date): WorkCard {
  if (!item.ok) return { root: item.root, title: item.title, meta: [], flags: [{ text: `⚠ ${mobileWording(item.error)}`, tone: "shu" }] };
  const { work } = item;
  const meta = [`${work.stats.episodeCount}話`, `${formatCount(work.stats.totals.net)}字`];
  if (work.lastWrittenAt !== undefined) meta.push(`最後に書いた日：${dayLabel(new Date(work.lastWrittenAt), now)}`);
  const flags: WorkCard["flags"] = [];
  if (work.stats.conflictedCount > 0) flags.push({ text: `競合：${work.stats.conflictedCount}話`, tone: "shu" });
  // 話数の重複・欠番（本体の作品一覧と同じ印。設計書 4.2 A・B）
  for (const mark of workEpisodeNumberMarks(checkWorkEpisodeNumbers(work.episodes, work.format))) flags.push({ text: mark, tone: "warn" });
  return { root: work.root, title: work.title, meta, flags };
}

/** 日の言い方：今日・昨日・「10月21日」・年が違えば「2025年10月21日」（端末の時刻の日で見る） */
export function dayLabel(date: Date, now: Date): string {
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diff = Math.round((day(now) - day(date)) / 86_400_000);
  if (diff === 0) return "今日";
  if (diff === 1) return "昨日";
  const md = `${date.getMonth() + 1}月${date.getDate()}日`;
  return date.getFullYear() === now.getFullYear() ? md : `${date.getFullYear()}年${md}`;
}

/** 話の一覧の上のバーの補い（「19話・41,200字」） */
export function workSummary(work: ScannedWork): string {
  return `${work.stats.episodeCount}話・${formatCount(work.stats.totals.net)}字`;
}

/** 話の一覧の1行 */
export type EpisodeListRow =
  | { type: "chapter"; name: string; missingStart: boolean }
  | {
      type: "episode";
      path: string;
      no: string;
      name: string;
      chars: string;
      conflict: boolean;
      /** 編集者が校閲中（本体の鍵。誰かは出さない。設計書 4.2 B「校閲中の鍵」） */
      locked: boolean;
      /** 同じ話数をほかの話も名乗っている */
      duplicated: boolean;
    };

/** 話の一覧の頭に出す欠番（「話数の欠番：第5話・第7話」。多ければ先頭の5つと「ほかN件」）。無ければ undefined */
export function missingNumbersLine(work: ScannedWork): string | undefined {
  const { missing } = checkWorkEpisodeNumbers(work.episodes, work.format);
  if (missing.length === 0) return undefined;
  const unit = episodeUnit(work.format);
  const shown = missing.slice(0, 5).map((number) => unit.label(number)).join("・");
  return `話数の欠番：${shown}${missing.length > 5 ? ` ほか${missing.length - 5}件` : ""}`;
}

/** 話の一覧の行（章の見出しと話） */
export function episodeListRows(work: ScannedWork): EpisodeListRow[] {
  const duplicated = new Set(checkWorkEpisodeNumbers(work.episodes, work.format).duplicated);
  const row = (episode: EpisodeFile): EpisodeListRow => episodeRow(episode, work, duplicated);
  if (work.chapters.length === 0) return work.episodes.map(row);
  const grouping = groupEpisodesByChapter(work.episodes, work.chapters, workFolderLocation(work));
  return [
    ...grouping.ungrouped.map(row),
    ...grouping.groups.flatMap((group): EpisodeListRow[] => [
      { type: "chapter", name: group.chapter.name, missingStart: group.missingStart },
      ...group.episodes.map(row),
    ]),
  ];
}

function episodeRow(episode: EpisodeFile, work: ScannedWork, duplicatedNumbers: ReadonlySet<number>): EpisodeListRow {
  const no = formatChapterLabel(episode, work.format);
  const title = episodeTitle(episode, no);
  // 話数が読めない話は、本体と同じくファイルの名前を見出しにする
  const name = no ? (title ?? "") : [episodeListLabel(episode, no, work.format), title].filter(Boolean).join("　");
  const chars = isCollectedFile(episode.collectedCount)
    ? `${episode.collectedCount}話ぶん　${formatCount(episode.counts.net)}字`
    : `${formatCount(episode.counts.net)}字`;
  const storePath = toStorePath(episode.filePath);
  const inWork = storePath?.startsWith(`${work.root}/`) ? storePath.slice(work.root.length + 1) : undefined;
  const lock = inWork ? lockOf(work.locks, inWork) : undefined;
  const start = episode.chapterStart;
  const end = episode.chapterEnd ?? start;
  let duplicated = false;
  if (start !== null && end !== null && !episode.date && (episode.kind === "本編" || episode.kind === "不明")) {
    for (let number = start; number <= Math.min(end, start + 10000); number += 1) if (duplicatedNumbers.has(number)) duplicated = true;
  }
  return {
    type: "episode",
    path: episode.filePath,
    no,
    name,
    chars,
    conflict: episode.hasConflictMarkers,
    locked: lock?.holderKind === "editor",
    duplicated,
  };
}

/** 章立ての開始の話（作品フォルダーからの相対）と照らす作品の場所（話の `filePath` と同じ形） */
function workFolderLocation(work: ScannedWork): string {
  return fromStorePath(work.root);
}

/**
 * 同期の状態の印（見本の作品一覧の「送っていない話：1」「同期済み」）。git で持っていない作品は出さない。
 * 原稿のほかの変更しか無いときは「送っていない変更」（送り忘れに気づけるように。設計書 6章）
 */
export function syncFlag(state: WorkSyncState | undefined): { text: string; tone: "warn" | "ok" } | undefined {
  if (!state) return undefined;
  if (state.unsent.length > 0) return { text: `送っていない話：${state.unsent.length}`, tone: "warn" };
  if (state.otherCount > 0) return { text: `送っていない変更：${state.otherCount}`, tone: "warn" };
  return { text: "同期済み", tone: "ok" };
}
