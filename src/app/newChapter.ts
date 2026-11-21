import { CHAPTERS_FILE, CHAPTERS_SCHEMA_VERSION, assertUniqueStarts, findChapterStartingAt, parseChapterSet, withChapterStartingAt, type Chapter } from "../shared";
import { FileNotFoundError, type FileStore } from "../platform/fileStore";
import { readWorkLayout } from "../platform/workScan";
import { ledgerShapeProblem } from "../platform/ledgerShapeGate";

/**
 * **章を立てる**（原稿エディターの上のバーの［…］→ 章を立てる。設計書 4.4「［…］：作品と話の操作（新しい話・章を立てる・…）」）。
 *
 * 開いている話から始まる章を、作品の章立て（`設定/章立て.json`）に置く。形は本体と同じ：
 * - 中身の組み立ては本体の `withChapterStartingAt`（その話から始まる章が既にあれば**改名**）。読むのは `parseChapterSet`
 *   （**壊れていたら直さずに止める**）。書く前の関所は `assertUniqueStarts`
 * - 書き方は本体の `ChapterStore.save` と同じ：`{ schemaVersion, chapters }` を2字下げの JSON に、末に改行
 * - **読んだあとで外で変わっていたら書かない**（本体と同じ。書く直前に読み直して、読んだときと同じ中身のときだけ書き換える。
 *   無かったものは `create`〈在れば失敗〉、在ったものは `overwrite`〈消えていれば失敗〉）
 * - 話の指し方は作品フォルダーからの場所（`本文/第3話.txt`）
 */

export interface ChapterPlan {
  /** 章立ての置き場（置き場の根から） */
  path: string;
  /** 読んだときの中身（無ければ null） */
  before: Uint8Array | null;
  chapters: Chapter[];
  schemaVersion: string;
  /** 作品フォルダーからの、開いている話の場所 */
  start: string;
  /** その話から始まる章の、いまの名前（無ければ undefined） */
  current?: string;
}

/** 開いている話（置き場の根からの場所）の章を立てる準備：章立てを読む。壊れていれば投げる */
export async function planChapter(store: FileStore, root: string, episodePath: string): Promise<ChapterPlan> {
  const layout = await readWorkLayout(store, root);
  const path = `${layout.settings}/${CHAPTERS_FILE}`;
  let before: Uint8Array | null = null;
  try {
    before = await store.readFile(path);
  } catch (error) {
    if (!(error instanceof FileNotFoundError)) throw error;
  }
  const set = before ? parseChapterSet(JSON.parse(new TextDecoder().decode(before))) : { schemaVersion: CHAPTERS_SCHEMA_VERSION, chapters: [] };
  const start = episodePath.startsWith(`${root}/`) ? episodePath.slice(root.length + 1) : episodePath;
  const current = findChapterStartingAt(set.chapters, start)?.name;
  return { path, before, chapters: set.chapters, schemaVersion: set.schemaVersion || CHAPTERS_SCHEMA_VERSION, start, ...(current !== undefined ? { current } : {}) };
}

/** 本体と同じ書き方の中身 */
export function chapterFileBytes(schemaVersion: string, chapters: readonly Chapter[]): Uint8Array {
  const body = JSON.stringify({ schemaVersion: schemaVersion || CHAPTERS_SCHEMA_VERSION, chapters }, null, 2);
  return new TextEncoder().encode(`${body}\n`);
}

const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);

/** 章を置いて書く。読んだあとで外で変わっていれば書かずに投げる。改名なら "renamed"、新しく立てたなら "added" */
export async function saveChapter(store: FileStore, plan: ChapterPlan, name: string): Promise<"added" | "renamed"> {
  // モバイル版の知らない新しい形なら書かない（2026-11-21 作者の答え「台帳の形が変わったときだけ止める」）
  const newer = ledgerShapeProblem("章立て", plan.before ? new TextDecoder().decode(plan.before) : undefined, CHAPTERS_SCHEMA_VERSION);
  if (newer) throw new Error(newer);
  const chapters = withChapterStartingAt(plan.chapters, plan.start, name);
  assertUniqueStarts(chapters);
  const bytes = chapterFileBytes(plan.schemaVersion, chapters);
  let now: Uint8Array | null = null;
  try {
    now = await store.readFile(plan.path);
  } catch (error) {
    if (!(error instanceof FileNotFoundError)) throw error;
  }
  const unchanged = plan.before === null ? now === null : now !== null && sameBytes(now, plan.before);
  if (!unchanged) throw new Error(`${CHAPTERS_FILE} が外で変わったので、書きませんでした。もう一度開いてください`);
  if (plan.before === null) {
    await store.createDirectory(plan.path.slice(0, plan.path.lastIndexOf("/")));
    await store.writeFile(plan.path, bytes, { mode: "create" });
  } else {
    await store.writeFile(plan.path, bytes, { mode: "overwrite" });
  }
  return plan.current !== undefined ? "renamed" : "added";
}
