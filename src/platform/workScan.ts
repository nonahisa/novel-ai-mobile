import {
  AIWRITER_DIR,
  CHAPTERS_FILE,
  CONFIG_FILE,
  DEFAULT_MANUSCRIPT_DIR,
  DEFAULT_SETTINGS_DIR,
  MANUSCRIPT_TREE_DEPTH,
  PLOT_FILE,
  acceptManuscriptEntry,
  addCounts,
  compareEpisodes,
  containsConflictMarkers,
  countEpisodeChars,
  decodeBytes,
  detectEol,
  emptyCounts,
  inferChapterHint,
  isCollectedFile,
  isKnownNonManuscript,
  isWorkInfoFile,
  matchWorkFormat,
  parseChapterSet,
  parseCollectedFile,
  parseEpisodeFileName,
  parseEpisodeMetadata,
  parsePlotMarkdown,
  resolveManuscriptDirAsync,
  toChapterHintNote,
  type Chapter,
  type CharCounts,
  type EntryKind,
  type EpisodeFile,
  type Listing,
  type MemoMarkers,
  type WorkFormatKey,
} from "../shared";
import { FileNotFoundError, dirname, joinStorePath, normalizeStorePath, type FileStore } from "./fileStore";
import { readWorkMemoMarkers } from "./memoMarkers";
import { basename, extname, fromStorePath, join, toStorePath } from "./paths";

/**
 * **端末の中の作品を読む**（作品一覧 A・話の一覧 B。設計書 4.2）。
 *
 * 本体の走査（`core/scanner.ts` の `scanWork`）は vscode に頼るので、そのまま借りられない。
 * 走査が使う**vscode に触らない部品を、同じ順に同じ形で通す**（写さない。`src/shared.ts` から取る）：
 *
 * - 本文フォルダーの決め方・何を原稿として拾うか：`resolveManuscriptDirAsync`・`acceptManuscriptEntry`・`isKnownNonManuscript`
 * - 話の名前・頭書き・合本・作品情報・補った話数：`parseEpisodeFileName`・`parseEpisodeMetadata`・`parseCollectedFile`・
 *   `isWorkInfoFile`・`inferChapterHint`
 * - 字数：`episodeBodyForCount`・`countEpisodeChars`（作品のメモの印を渡す。`readWorkMemoMarkers`）。競合の印のある話は数えない
 * - 並べ方：`compareEpisodes`。章：`設定/章立て.json` を `parseChapterSet` で読む（束ねは画面の側で `groupEpisodesByChapter`）
 *
 * 場所は本体の部品へ `novelai-device:/works/...` の文字列で渡す（`paths.ts`。Windows のテストでも `/` 区切りのまま）。
 * 話の `filePath` もこの文字列。置き場へは `toStorePath` で戻す。
 *
 * **止め方は本体と同じ**：作品の設定（`.aiwriter/config.json`）が読めない・壊れている・メモの印が壊れているときは、
 * その作品だけ止めて理由を返す（`WorkListItem` の `ok: false`）。黙って既定へ戻すと、作者が選んだ印の行が字数に入る。
 * 章立てが読めないときは止めない（本体の作品一覧と同じく、章なしで話を並べ、理由を `chapterError` に残す）。
 */

/** 読んだ作品 */
export interface ScannedWork {
  /** 置き場の根からの場所（作品のフォルダーの名前） */
  root: string;
  /** 題。作品の設定の `workTitle`、無ければフォルダーの名前 */
  title: string;
  /** 作品の形式（プロットの `## 形式`）。書かれていなければ undefined */
  format?: WorkFormatKey;
  /** 話。並びは本体の `compareEpisodes` */
  episodes: EpisodeFile[];
  /** 話数（合本は中の話の数で数える）・字数の合計（競合の印のある話は入れない）・競合の印のある話の数 */
  stats: { episodeCount: number; totals: CharCounts; conflictedCount: number };
  /** 章立て（無ければ空） */
  chapters: Chapter[];
  /** 章立てを読めなかった理由。読めたか無ければ undefined */
  chapterError?: string;
  /** 最後に書いた日（ミリ秒）。分からなければ undefined */
  lastWrittenAt?: number;
}

/** 作品一覧の1件。読めなかった作品は理由だけ持つ */
export type WorkListItem =
  | { ok: true; work: ScannedWork }
  | { ok: false; root: string; title: string; error: string };

export interface ScanOptions {
  /** 最後に書いた日を調べる口（端末では git の最後の版の日。`git.ts` の `lastCommitTime`） */
  lastWrittenOf?: (root: string) => Promise<number | undefined>;
}

/**
 * 置き場の中の作品のフォルダー。**直下のフォルダーのうち、`.git` か `.aiwriter` を持つもの**。
 *
 * 作品は GitHub から取り寄せる（`.git` がある）か、新しく作る（本体と同じく `.aiwriter/config.json` を置く）。
 * 置き場の直下には縦書きの試し（`試し/`）・動作確認ページの取得（`確認_git/`）・書きかけの控え（`.novelai-drafts/`）も
 * あるので、ただのフォルダーは作品と見ない。並びはフォルダーの名前の順。
 */
export async function findWorkRoots(store: FileStore): Promise<string[]> {
  let top;
  try {
    top = await store.listEntries("");
  } catch (error) {
    if (error instanceof FileNotFoundError) return [];
    throw error;
  }
  const roots: string[] = [];
  for (const [name, kind] of top) {
    if (kind !== "directory" || name.startsWith(".")) continue;
    let inside;
    try {
      inside = await store.listEntries(name);
    } catch {
      continue;
    }
    if (inside.some(([child, childKind]) => childKind === "directory" && (child === ".git" || child === AIWRITER_DIR))) {
      roots.push(name);
    }
  }
  return roots.sort((a, b) => a.localeCompare(b, "ja"));
}

/** 作品の一覧。1作品が読めなくても、ほかの作品は読む */
export async function listWorks(store: FileStore, options: ScanOptions = {}): Promise<WorkListItem[]> {
  const roots = await findWorkRoots(store);
  return Promise.all(
    roots.map(async (root): Promise<WorkListItem> => {
      try {
        return { ok: true, work: await scanWorkFolder(store, root, options) };
      } catch (error) {
        return { ok: false, root, title: folderTitle(root), error: errorText(error) };
      }
    })
  );
}

/** 作品の設定から読む置き場の形（本体の `workPaths` の一部と同じ既定） */
export interface WorkLayout {
  title: string;
  /** 本文フォルダー（置き場の根から） */
  manuscript: string;
  /** 設定フォルダー（置き場の根から） */
  settings: string;
  memoMarkers: MemoMarkers;
}

/**
 * 作品の設定（`.aiwriter/config.json`）を読む。無ければ既定（`本文/`・`設定/`）。
 *
 * 本体の `parseWorkConfig`（`core/workRegistry.ts`）は vscode に頼る部品の中にあるので借りられない。
 * ここで読むのは、作品を読むのに要る欄（題・本文と設定の置き場）だけ。メモの印は `readWorkMemoMarkers`
 * （本体の `memoMarkersOfConfigText`）。**読めない・壊れていれば投げる**（本体と同じ「作品設定を読み込めません」）。
 */
export async function readWorkLayout(store: FileStore, root: string): Promise<WorkLayout> {
  const configPath = joinStorePath(root, AIWRITER_DIR, CONFIG_FILE);
  let value: Record<string, unknown> = {};
  let memoMarkers: MemoMarkers;
  try {
    let bytes: Uint8Array | undefined;
    try {
      bytes = await store.readFile(configPath);
    } catch (error) {
      if (!(error instanceof FileNotFoundError)) throw error;
    }
    if (bytes) {
      const raw: unknown = JSON.parse(new TextDecoder().decode(bytes));
      if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
        throw new Error("作品設定はJSONオブジェクトである必要があります。");
      }
      value = raw as Record<string, unknown>;
    }
    memoMarkers = await readWorkMemoMarkers(store, root);
  } catch (error) {
    throw new Error(`作品設定を読み込めません: ${errorText(error)}`);
  }
  const title = typeof value.workTitle === "string" && value.workTitle.trim() ? value.workTitle.trim() : folderTitle(root);
  return {
    title,
    manuscript: insideWork(root, value.manuscriptDir, DEFAULT_MANUSCRIPT_DIR, "manuscriptDir"),
    settings: insideWork(root, value.settingsDir, DEFAULT_SETTINGS_DIR, "settingsDir"),
    memoMarkers,
  };
}

/** 作品のフォルダーの中の相対パスにする。外を指していれば止める（本体の `resolveInsideWork` と同じ文言） */
function insideWork(root: string, raw: unknown, fallback: string, key: string): string {
  const sub = typeof raw === "string" && raw.trim() ? raw.trim() : fallback;
  const normalized = normalizeStorePath(sub);
  if (/^([\\/]|[A-Za-z]:)/.test(sub) || normalized.split("/").includes("..")) {
    throw new Error(`作品設定を読み込めません: ${key} は作品フォルダ内の相対パスにしてください。`);
  }
  return joinStorePath(root, normalized);
}

/** 1作品を読む（本体の `scanWork` と同じ順）。作品の設定が読めなければ投げる */
export async function scanWorkFolder(store: FileStore, root: string, options: ScanOptions = {}): Promise<ScannedWork> {
  const layout = await readWorkLayout(store, root);
  const rootLoc = fromStorePath(root);
  const settingsLoc = fromStorePath(layout.settings);
  const accept = acceptManuscriptEntry(settingsLoc);
  const targetLoc = await resolveManuscriptDirAsync(
    { root: rootLoc, manuscript: fromStorePath(layout.manuscript), settings: settingsLoc },
    {
      kind: (location) => kindOf(store, location),
      list: (location) => listOf(store, location),
    }
  );
  // 作品の根を歩くときだけ、根の直下の README などを外す（本体と同じ）
  const rootDir = targetLoc === rootLoc ? targetLoc : undefined;

  let formatRead: Promise<WorkFormatKey | undefined> | undefined;
  const formatOnce = () => (formatRead ??= readFormat(store, layout.settings));

  const episodes: EpisodeFile[] = [];
  for (const file of await readTree(store, targetLoc, accept)) {
    const filePath = file.location;
    const fileName = basename(filePath);
    const ext = extname(fileName).toLowerCase();
    if (isKnownNonManuscript(filePath, rootDir, settingsLoc)) continue;

    const parsed = parseEpisodeFileName(fileName);
    let counts = emptyCounts();
    let hasConflictMarkers = false;
    let eol: EpisodeFile["eol"] = null;
    let hasMixedEol = false;
    let collected: ReturnType<typeof parseCollectedFile> = null;
    let chapterHint: ReturnType<typeof inferChapterHint> = null;
    let meta = { hasMetadata: false, title: null as string | null, declaredCharCount: null as number | null, updatedAt: null as string | null };
    let workInfo = false;
    try {
      // 読めなかったファイルは0字として並べ、走査は止めない（本体と同じ）
      if (!file.bytes) throw new Error("読めなかった");
      const text = decodeBytes(file.bytes).text;
      if (isWorkInfoFile(fileName, text)) {
        workInfo = true;
      } else {
        ({ eol, hasMixedEol } = detectEol(text));
        const parsedMeta = parseEpisodeMetadata(text);
        meta = {
          hasMetadata: parsedMeta.hasMetadata,
          title: parsedMeta.title,
          declaredCharCount: parsedMeta.declaredCharCount,
          updatedAt: parsedMeta.updatedAt,
        };
        collected = parseCollectedFile(text);
        if (parsed.kind === "不明" && !collected) {
          chapterHint = inferChapterHint({ fileName, metaTitle: parsedMeta.title, body: parsedMeta.body, format: await formatOnce() });
        }
        hasConflictMarkers = containsConflictMarkers(text);
        if (!hasConflictMarkers) {
          const pieces = { collected, metaBody: parsedMeta.body };
          counts = countEpisodeChars(text, { ext, excludeRuby: true, memoMarkers: layout.memoMarkers }, pieces);
        }
      }
    } catch {
      // 読めないファイルは0字
    }
    // 作品情報（about.txt）は話に数えない
    if (workInfo) continue;

    const collectedChapters = (collected ?? []).map((episode) => episode.chapter).filter((chapter): chapter is number => chapter !== null);
    const inferred = chapterHint?.status === "inferred" ? chapterHint : null;
    episodes.push({
      filePath,
      fileName,
      ext,
      chapterStart: collectedChapters.length > 0 ? Math.min(...collectedChapters) : (inferred?.chapter ?? parsed.chapterStart),
      chapterEnd: collectedChapters.length > 0 ? Math.max(...collectedChapters) : (inferred?.chapter ?? parsed.chapterEnd),
      subtitle: parsed.subtitle ?? meta.title ?? inferred?.subtitle ?? null,
      kind: inferred ? "本編" : parsed.kind,
      ...(chapterHint ? { chapterHint: toChapterHintNote(chapterHint) } : {}),
      isInitialName: parsed.isInitialName,
      date: parsed.date,
      dateSeq: parsed.dateSeq,
      counts,
      hasMetadata: meta.hasMetadata,
      metaTitle: meta.title,
      declaredCharCount: meta.declaredCharCount,
      metaUpdatedAt: meta.updatedAt,
      hasConflictMarkers,
      collectedCount: collected ? collected.length : null,
      memoBadge: "",
      eol,
      hasMixedEol,
    });
  }
  episodes.sort(compareEpisodes);

  let totals = emptyCounts();
  let conflictedCount = 0;
  let episodeCount = 0;
  for (const episode of episodes) {
    episodeCount += isCollectedFile(episode.collectedCount) ? episode.collectedCount! : 1;
    if (episode.hasConflictMarkers) {
      conflictedCount += 1;
      continue;
    }
    totals = addCounts(totals, episode.counts);
  }

  const { chapters, chapterError } = await readChapters(store, layout.settings);
  let lastWrittenAt: number | undefined;
  try {
    lastWrittenAt = await options.lastWrittenOf?.(root);
  } catch {
    lastWrittenAt = undefined;
  }
  return {
    root,
    title: layout.title,
    ...(await readFormatIfRead(formatRead)),
    episodes,
    stats: { episodeCount, totals, conflictedCount },
    chapters,
    ...(chapterError !== undefined ? { chapterError } : {}),
    ...(lastWrittenAt !== undefined ? { lastWrittenAt } : {}),
  };
}

/** 形式は、補いの要る話が無ければ読まない（本体と同じ）。読んだときだけ載せる */
async function readFormatIfRead(read: Promise<WorkFormatKey | undefined> | undefined): Promise<{ format?: WorkFormatKey }> {
  const format = await read;
  return format ? { format } : {};
}

/** 章立て（`設定/章立て.json`）。無ければ空、読めなければ理由（本体と同じく止めない） */
async function readChapters(store: FileStore, settings: string): Promise<{ chapters: Chapter[]; chapterError?: string }> {
  let bytes: Uint8Array;
  try {
    bytes = await store.readFile(joinStorePath(settings, CHAPTERS_FILE));
  } catch (error) {
    if (error instanceof FileNotFoundError) return { chapters: [] };
    return { chapters: [], chapterError: errorText(error) };
  }
  try {
    return { chapters: parseChapterSet(JSON.parse(decodeBytes(bytes).text)).chapters };
  } catch (error) {
    return { chapters: [], chapterError: errorText(error) };
  }
}

/** 作品の形式（プロットの `## 形式`）。読めなければ「決めていない」（本体の `readWorkFormat` と同じ） */
async function readFormat(store: FileStore, settings: string): Promise<WorkFormatKey | undefined> {
  try {
    const bytes = await store.readFile(joinStorePath(settings, PLOT_FILE));
    return matchWorkFormat(parsePlotMarkdown(decodeBytes(bytes).text).sections.format);
  } catch {
    return undefined;
  }
}

/** 場所の種類。見つからなければ `missing`、それ以外の失敗は投げる（本体の `resolveManuscriptDir` と同じ） */
async function kindOf(store: FileStore, location: string): Promise<EntryKind | "missing"> {
  const path = toStorePath(location);
  if (path === undefined) return "missing";
  if (path === "") return "directory";
  let entries;
  try {
    entries = await store.listEntries(dirname(path));
  } catch (error) {
    if (error instanceof FileNotFoundError) return "missing";
    throw error;
  }
  const name = path.split("/").pop()!;
  const found = entries.find(([entry]) => entry === name);
  return found ? found[1] : "missing";
}

/** フォルダーの中身。読めなければ undefined（「無い」とみなす。本体と同じ） */
async function listOf(store: FileStore, location: string): Promise<Listing | undefined> {
  const path = toStorePath(location);
  if (path === undefined) return undefined;
  try {
    return await store.listEntries(path);
  } catch {
    return undefined;
  }
}

/** 拾った原稿。読めなければ `bytes` が無い（一覧からは消さない） */
interface TreeFile {
  location: string;
  bytes?: Uint8Array;
}

/**
 * 本文の置き場の下を歩いて原稿を読む（本体の一括読み `readTextTree` と同じ歩き方：`.` で始まる名前は飛ばし、
 * 深さは `MANUSCRIPT_TREE_DEPTH` まで、拾うかは `accept`）
 */
async function readTree(
  store: FileStore,
  dirLoc: string,
  accept: ReturnType<typeof acceptManuscriptEntry>,
  depth = 0
): Promise<TreeFile[]> {
  if (depth > MANUSCRIPT_TREE_DEPTH) return [];
  const entries = await listOf(store, dirLoc);
  if (!entries) return [];
  const found: TreeFile[] = [];
  for (const [name, kind] of entries) {
    if (name.startsWith(".")) continue;
    const location = join(dirLoc, name);
    if (kind === "file") {
      if (!accept(name, "file", location)) continue;
      const path = toStorePath(location);
      try {
        found.push({ location, bytes: path === undefined ? undefined : await store.readFile(path) });
      } catch {
        found.push({ location });
      }
    } else if (kind === "directory" && accept(name, "directory", location)) {
      found.push(...(await readTree(store, location, accept, depth + 1)));
    }
  }
  return found;
}

/** フォルダーの名前（作品の題が無いときの題） */
export function folderTitle(root: string): string {
  return normalizeStorePath(root).split("/").pop() ?? root;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
