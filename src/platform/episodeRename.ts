import {
  BOOK_DIR,
  BOOK_FILE,
  BOOK_SCHEMA_VERSION,
  CHAPTERS_FILE,
  CHAPTERS_SCHEMA_VERSION,
  POSTING_FILE,
  POSTING_SCHEMA_VERSION,
  READINGS_DIRECTORY,
  AIWRITER_DIR,
  SYNOPSIS_SCHEMA_VERSION,
  TIMELINE_SCHEMA_VERSION,
  containsConflictMarkers,
  detectJsonFileFormat,
  formatJsonForFile,
  lockOf,
  normalizeEpisodePath,
  parseEpisodeFileName,
  readingDictionaryFileName,
  readingDictionaryMoveConflictMessage,
  renameUnnumberedSynopses,
  renumberBookPositions,
  renumberChapterSet,
  renumberPostingPosts,
  renumberTimelineEpisodes,
  sanitizeFileName,
} from "../shared";
import { FileNotFoundError, joinStorePath, type FileStore } from "./fileStore";
import { ledgerShapeProblem } from "./ledgerShapeGate";
import { readTextFile, writeTextFilePreservingFormat, type TextFileContent } from "./textFile";
import { readWorkLayout, scanWorkFolder } from "./workScan";
import { CHAPTER_SYNOPSES_FILE } from "./synopsisStore";
import { journalPathFor } from "../app/draftJournal";

/**
 * **話のファイル名を変え、パスで話を指す台帳を付け替える**（2026-11-21 作者の答え「パソコンと同じにする」：サブタイトル案を
 * 選ぶと、確かめてからファイル名を変え、台帳も合わせる。本体の `core/episodeRename.ts` の `renameEpisodeFile` と
 * `features/episodeLedgers.ts` の `followEpisodeFileRenames` と同じ決まり）。
 *
 * 名前：`<元の名前>_<サブタイトル><拡張子>`（本体と同じく区切りは `_`。話数の部分は元のまま・既にある名前にはしない・
 * **本文には一切触れない**）。本体の `sanitizeFileName` でファイル名に使えない字を替える。
 *
 * 付け替える台帳（本体の6つ。決まりは本体の `core/episodeRenumber.ts`・`core/readingDictionaryPlace.ts`）：
 * 章立て（`chapters[].startEpisodePath`）・本の設計図（`書籍/book.json` の挿絵と改ページ）・年表（`timeline.json`）・
 * 投稿状態（`posts`・`revisions`）・各話あらすじ（話数の読めない話はファイル名で引くので付け替える。話数のある話の `fileName`・
 * `title` も、本体があとで追随させる所をその場で直す）・読みの辞書（`.aiwriter/readings/<話>.json` を動かし、中の `episode` を直す）。
 *
 * **守り**：
 * - **台帳は名前を変える前に全部読む。** 壊れている・モバイル版の知らない新しい形（`ledgerShapeProblem`）のものが1つでもあれば、
 *   名前を変えない（付け替えられない台帳を残して名前だけ変わると、その台帳から話が見失われる）
 * - 台帳の中身は JSON をそのまま読み、**話を指すパスの欄だけ**を差し替えて書く（本体の型を通さないので、知らない欄も落とさない）。
 *   書き換えは `writeTextFilePreservingFormat`（ハッシュの照らし合わせ・元を退避・改行の形）
 * - 校閲中の話・競合が残っている話・書きかけの控えがある話は変えない
 * - ファイルの名前替えは、同じ中身を新しい名前で「無いときだけ作る」→ 中身が同じか確かめる → 元を消す（置き場に名前替えの口が無い）。
 *   元を消せなければ新しいほうを消して戻す
 */

export interface EpisodeRenameInput {
  store: FileStore;
  /** 作品の根（置き場の中の場所） */
  root: string;
  /** 話（置き場の中の場所） */
  path: string;
  subtitle: string;
  /** 選んでいない競合の話（置き場の中の場所） */
  undecidedConflicts?: readonly string[];
  /** 書く直前に、その道をアプリが書いた控えへ（`touchedPaths.ts`。git が同じ秒・同じ大きさの書き換えを見落とさないように） */
  beforeWrite?: (path: string) => Promise<void>;
}

export type EpisodeRenameOutcome =
  | { ok: true; newPath: string; newFileName: string; notes: string[] }
  | { ok: false; message: string };

/** 付けようとしているファイル名（作者に見せる）。サブタイトルが空になれば undefined */
export function renamedEpisodeFileName(fileName: string, subtitle: string): string | undefined {
  const dot = fileName.lastIndexOf(".");
  const ext = dot > 0 ? fileName.slice(dot) : "";
  const base = dot > 0 ? fileName.slice(0, dot) : fileName;
  const cleaned = sanitizeFileName(subtitle).trim();
  if (!cleaned) return undefined;
  return `${base}_${cleaned}${ext}`;
}

/** 読んだ台帳（JSON をそのまま）と、書くときの照らし合わせ */
interface LoadedLedger {
  label: string;
  path: string;
  value: Record<string, unknown>;
  content: TextFileContent;
  bytes: Uint8Array;
}

type LedgerRead = { kind: "missing" } | { kind: "loaded"; ledger: LoadedLedger } | { kind: "blocked"; message: string };

async function readLedger(store: FileStore, label: string, path: string, known: string | number | undefined): Promise<LedgerRead> {
  let content: TextFileContent;
  let bytes: Uint8Array;
  try {
    bytes = await store.readFile(path);
    content = await readTextFile(store, path);
  } catch (error) {
    if (error instanceof FileNotFoundError) return { kind: "missing" };
    return { kind: "blocked", message: `${label}を読めないので、名前を変えませんでした` };
  }
  let value: unknown;
  try {
    value = JSON.parse(content.text);
  } catch {
    return { kind: "blocked", message: `${label}が壊れているので、名前を変えませんでした（パソコンで直してください）` };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return { kind: "blocked", message: `${label}の形が違うので、名前を変えませんでした` };
  if (known !== undefined) {
    const newer = ledgerShapeProblem(label, content.text, known);
    if (newer) return { kind: "blocked", message: `${newer}（名前も変えませんでした）` };
  }
  return { kind: "loaded", ledger: { label, path, value: value as Record<string, unknown>, content, bytes } };
}

async function writeLedger(store: FileStore, ledger: LoadedLedger, value: Record<string, unknown>): Promise<string | undefined> {
  const text = formatJsonForFile(value, detectJsonFileFormat(ledger.bytes));
  const written = await writeTextFilePreservingFormat(store, ledger.path, text, ledger.content, ledger.content.hash);
  if (written.ok) return undefined;
  return written.reason === "modified_externally" ? `${ledger.label}は読んだあとで変わったので、付け替えませんでした` : `${ledger.label}に書けませんでした`;
}

const asArray = (value: unknown): Record<string, unknown>[] => (Array.isArray(value) ? (value as Record<string, unknown>[]) : []);

const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);

/** ファイルを新しい名前へ（中身はそのまま）。新しい名前が在れば投げる。元を消せなければ新しいほうを消して投げる */
async function moveFile(store: FileStore, from: string, to: string): Promise<void> {
  const bytes = await store.readFile(from);
  await store.writeFile(to, bytes, { mode: "create" });
  const copied = await store.readFile(to);
  if (!sameBytes(copied, bytes)) {
    await store.deleteFile(to).catch(() => undefined);
    throw new Error("新しい名前のファイルの中身が元と違ったので、名前を変えませんでした");
  }
  try {
    await store.deleteFile(from);
  } catch (error) {
    await store.deleteFile(to).catch(() => undefined);
    throw error;
  }
}

async function exists(store: FileStore, path: string): Promise<boolean> {
  try {
    await store.readFile(path);
    return true;
  } catch (error) {
    if (error instanceof FileNotFoundError) return false;
    return true;
  }
}

export async function renameEpisodeWithLedgers(input: EpisodeRenameInput): Promise<EpisodeRenameOutcome> {
  const { store, root, path } = input;
  if (!path.startsWith(`${root}/`)) return { ok: false, message: "この話は作品の中にありません" };
  const slash = path.lastIndexOf("/");
  const fileName = path.slice(slash + 1);
  const newFileName = renamedEpisodeFileName(fileName, input.subtitle);
  if (!newFileName) return { ok: false, message: "サブタイトルが空になりました" };
  const newPath = `${path.slice(0, slash)}/${newFileName}`;
  if (newPath === path) return { ok: false, message: "すでに同じ名前です" };
  if (await exists(store, newPath)) return { ok: false, message: `${newFileName} が既にあります` };

  // 話の側の守り
  let body;
  try {
    body = await readTextFile(store, path);
  } catch {
    return { ok: false, message: "話を読めないので、名前を変えませんでした" };
  }
  if (containsConflictMarkers(body.text) || input.undecidedConflicts?.includes(path)) return { ok: false, message: "競合が残っている話の名前は変えません" };
  if (await exists(store, journalPathFor(path))) return { ok: false, message: "この話に書きかけの控えがあります。先に話を開いて、保存するか捨ててから、名前を変えてください" };
  let layout;
  let work;
  try {
    [layout, work] = await Promise.all([readWorkLayout(store, root), scanWorkFolder(store, root)]);
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
  const relative = path.slice(root.length + 1);
  const newRelative = newPath.slice(root.length + 1);
  if (lockOf(work.locks, relative)) return { ok: false, message: "校閲中の話なので、名前を変えません" };

  // 台帳を先に全部読む（1つでも書けないなら、名前を変えない）
  const settings = layout.settings;
  const reads = {
    chapters: await readLedger(store, "章立て", joinStorePath(settings, CHAPTERS_FILE), CHAPTERS_SCHEMA_VERSION),
    book: await readLedger(store, "本の設計図", joinStorePath(settings, BOOK_DIR, BOOK_FILE), BOOK_SCHEMA_VERSION),
    timeline: await readLedger(store, "年表", joinStorePath(settings, "timeline.json"), TIMELINE_SCHEMA_VERSION),
    posting: await readLedger(store, "投稿状態", joinStorePath(settings, POSTING_FILE), POSTING_SCHEMA_VERSION),
    synopses: await readLedger(store, "各話あらすじ", joinStorePath(settings, CHAPTER_SYNOPSES_FILE), SYNOPSIS_SCHEMA_VERSION),
  };
  for (const read of Object.values(reads)) if (read.kind === "blocked") return { ok: false, message: read.message };
  const readingFrom = joinStorePath(root, AIWRITER_DIR, READINGS_DIRECTORY, readingDictionaryFileName(relative));
  const readingTo = joinStorePath(root, AIWRITER_DIR, READINGS_DIRECTORY, readingDictionaryFileName(newRelative));
  const reading = readingFrom === readingTo ? ({ kind: "missing" } as LedgerRead) : await readLedger(store, "読みの辞書", readingFrom, undefined);
  if (reading.kind === "blocked") return { ok: false, message: reading.message };
  if (reading.kind === "loaded" && (await exists(store, readingTo))) {
    return { ok: false, message: `${readingDictionaryMoveConflictMessage(path, newPath)}名前も変えませんでした` };
  }

  const touch = async (target: string) => {
    await input.beforeWrite?.(target).catch(() => undefined);
  };
  // 名前を変える（本文には触れない）
  try {
    await touch(path);
    await touch(newPath);
    await moveFile(store, path, newPath);
  } catch (error) {
    return { ok: false, message: `名前を変えられませんでした：${error instanceof Error ? error.message : String(error)}` };
  }

  // 台帳を付け替える。書けなかったものは知らせる（名前はもう変わっている）
  const notes: string[] = [];
  const moves = new Map([[normalizeEpisodePath(relative), normalizeEpisodePath(newRelative)]]);
  const follow = async (read: LedgerRead, patch: (value: Record<string, unknown>) => Record<string, unknown> | undefined) => {
    if (read.kind !== "loaded") return;
    const next = patch(read.ledger.value);
    if (!next) return;
    await touch(read.ledger.path);
    const failed = await writeLedger(store, read.ledger, next);
    if (failed) notes.push(failed);
  };
  await follow(reads.chapters, (value) => {
    const result = renumberChapterSet(asArray(value.chapters) as never, moves);
    return result.changed > 0 ? { ...value, chapters: result.chapters } : undefined;
  });
  await follow(reads.book, (value) => {
    const result = renumberBookPositions({ illustrations: asArray(value.illustrations) as never, pageBreaks: asArray(value.pageBreaks) as never }, moves);
    if (result.changed === 0) return undefined;
    return {
      ...value,
      ...(Array.isArray(value.illustrations) ? { illustrations: result.illustrations } : {}),
      ...(Array.isArray(value.pageBreaks) ? { pageBreaks: result.pageBreaks } : {}),
    };
  });
  await follow(reads.timeline, (value) => {
    const result = renumberTimelineEpisodes(asArray(value.episodes) as never, moves);
    return result.changed > 0 ? { ...value, episodes: result.episodes } : undefined;
  });
  await follow(reads.posting, (value) => {
    const posts = renumberPostingPosts(asArray(value.posts) as never, moves);
    // 修正版の出し直しの記録も同じ決まりで（本体の followPosting）
    const revisions = Array.isArray(value.revisions) ? renumberPostingPosts(asArray(value.revisions) as never, moves) : undefined;
    if (posts.changed === 0 && (revisions?.changed ?? 0) === 0) return undefined;
    return { ...value, posts: posts.posts, ...(revisions ? { revisions: revisions.posts } : {}) };
  });
  await follow(reads.synopses, (value) => {
    const episodes = asArray(value.episodes);
    const unnumbered = renameUnnumberedSynopses(episodes as never, [{ fromFileName: fileName, toFileName: newFileName }]);
    for (const name of unnumbered.collisions) notes.push(`各話あらすじ「${name}」：新しい名前のあらすじが既にあるため、付け替えませんでした`);
    // 話数のある話は鍵が話数なので動かないが、ファイル名と題が古いまま残る（本体はあとで追随させる。ここでその場で直す）
    const parsed = parseEpisodeFileName(newFileName);
    let changed = unnumbered.changed;
    const next = (unnumbered.episodes as Record<string, unknown>[]).map((episode) => {
      if (episode.chapter === null || episode.fileName !== fileName) return episode;
      changed++;
      const title = parsed.subtitle && episode.chapter === parsed.chapterStart && !episode.title ? { title: parsed.subtitle } : {};
      return { ...episode, fileName: newFileName, ...title };
    });
    return changed > 0 ? { ...value, episodes: next } : undefined;
  });
  if (reading.kind === "loaded") {
    try {
      // 中身はそのまま動かし、中の `episode`（どの話の辞書か）だけを新しい道へ（本体の moveReadingDictionary）
      await touch(readingFrom);
      await touch(readingTo);
      await moveFile(store, readingFrom, readingTo);
      const moved = await readLedger(store, "読みの辞書", readingTo, undefined);
      if (moved.kind === "loaded" && moved.ledger.value.episode !== newRelative) {
        const failed = await writeLedger(store, moved.ledger, { ...moved.ledger.value, episode: newRelative });
        if (failed) notes.push(failed);
      }
    } catch {
      notes.push("読みの辞書を付け替えられませんでした");
    }
  }
  return { ok: true, newPath, newFileName, notes };
}
