import {
  AIWRITER_DIR,
  CONFIG_FILE,
  MEMO_MARKER_IDS,
  detectJsonFileFormat,
  formatChapterLabel,
  formatJsonForFile,
  linesStartingWithMarkers,
  memoMarkersOf,
  parseWorkKind,
  resolveWorkKind,
  type MemoMarkerId,
  type MemoMarkers,
  type WorkKindKey,
} from "../shared";
import { FileNotFoundError, joinStorePath, type FileStore } from "./fileStore";
import { toStorePath } from "./paths";
import { readTextFile, writeTextFilePreservingFormat, type TextFileContent } from "./textFile";
import { readFormat, readWorkLayout, scanWorkFolder } from "./workScan";

/**
 * **作品の設定**（作品の長押し → 作品の設定。設計書 4.4.1。2026-11-21 作者の答え「形式・ジャンルも」）のうち、
 * 作品の設定ファイル（`.aiwriter/config.json`）に書く2つ：**メモの印**（`memoMarkers`。本体の `features/setMemoMarkers.ts`）と
 * **作品の種類**（`kind`。本体の `features/setWorkKind.ts`）。
 *
 * 本体と同じ決まり：
 * - **本文は1字も書き換えない**（変わるのは、どの行をメモと読むか・これから作る話の雛形と組み方だけ）
 * - **設定ファイルが無い作品では変えない**（本体の `WorkConfigMissingError`。モバイル版では［題を変える］で作られるので、そちらへ案内する）
 * - **壊れた設定は直さずに止める**。書き換えは変える欄だけで、ほかの欄・改行の形は保つ（`writeTextFilePreservingFormat`：ハッシュの照らし合わせ・元を退避）
 * - メモの印の**知らない名前（新しい版の印）は書かれたまま残す**
 * - 新しくオンにする印で始まる行があれば、切り替える前に数えて見せる（呼ぶのは画面。`findMarkedLines`）
 */

export type SettingsOutcome = { ok: true } | { ok: false; message: string };

export const CONFIG_MISSING_MESSAGE = "この作品には作品の設定ファイル（.aiwriter/config.json）がまだありません。先に作品の長押し →［題を変える］で題を決めると作られます";

interface LoadedConfig {
  path: string;
  value: Record<string, unknown>;
  content: TextFileContent;
  bytes: Uint8Array;
}

async function loadConfig(store: FileStore, root: string): Promise<LoadedConfig | { failed: string }> {
  const path = joinStorePath(root, AIWRITER_DIR, CONFIG_FILE);
  let content: TextFileContent;
  let bytes: Uint8Array;
  try {
    bytes = await store.readFile(path);
    content = await readTextFile(store, path);
  } catch (error) {
    if (error instanceof FileNotFoundError) return { failed: CONFIG_MISSING_MESSAGE };
    return { failed: "作品の設定ファイルを読めませんでした" };
  }
  let value: unknown;
  try {
    value = JSON.parse(content.text);
  } catch {
    // 壊れた設定は直さない（本体の決まり2）
    return { failed: "作品の設定ファイルが壊れているので、変えませんでした（パソコンで直してください）" };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return { failed: "作品の設定ファイルの形が違うので、変えませんでした" };
  return { path, value: value as Record<string, unknown>, content, bytes };
}

/** 変える欄だけ差し替えて書く（ほかの欄・並び・改行の形はそのまま） */
async function writeConfigFields(store: FileStore, root: string, patch: (value: Record<string, unknown>) => Record<string, unknown>): Promise<SettingsOutcome> {
  const loaded = await loadConfig(store, root);
  if ("failed" in loaded) return { ok: false, message: loaded.failed };
  const text = formatJsonForFile(patch(loaded.value), detectJsonFileFormat(loaded.bytes));
  const written = await writeTextFilePreservingFormat(store, loaded.path, text, loaded.content, loaded.content.hash);
  if (!written.ok) {
    return {
      ok: false,
      message: written.reason === "modified_externally" ? "読んだあとで作品の設定ファイルが変わったので、変えませんでした。同期のあとでもう一度" : "作品の設定ファイルに書けませんでした",
    };
  }
  return { ok: true };
}

/** メモの印を書く。知らない名前（新しい版の印）は残す（本体の `writeMemoMarkers` と同じ） */
export async function writeWorkMemoMarkers(store: FileStore, root: string, ids: readonly MemoMarkerId[]): Promise<SettingsOutcome> {
  const markers = memoMarkersOf(ids);
  if (markers.ids.length === 0) return { ok: false, message: "メモの印は1つ以上選んでください" };
  return writeConfigFields(store, root, (value) => {
    const written = Array.isArray(value.memoMarkers) ? value.memoMarkers.filter((id): id is string => typeof id === "string") : [];
    const unknown = written.filter((id) => !(MEMO_MARKER_IDS as readonly string[]).includes(id));
    return { ...value, memoMarkers: [...markers.ids, ...unknown] };
  });
}

/** いまの作品の種類（設定に書かれていなければ、形式が「脚本」なら台本、ほかは小説。本体の `readWorkKind`） */
export async function readWorkKindOf(store: FileStore, root: string): Promise<{ kind: WorkKindKey; configured: boolean }> {
  let configured: WorkKindKey | undefined;
  try {
    const bytes = await store.readFile(joinStorePath(root, AIWRITER_DIR, CONFIG_FILE));
    configured = parseWorkKind((JSON.parse(new TextDecoder().decode(bytes)) as { kind?: unknown }).kind);
  } catch {
    // 読めなくても種類のせいで止めない（本体と同じく小説として振る舞う）
    configured = undefined;
  }
  if (configured) return { kind: configured, configured: true };
  const layout = await readWorkLayout(store, root).catch(() => undefined);
  const format = layout ? await readFormat(store, layout.settings) : undefined;
  return { kind: resolveWorkKind(undefined, format), configured: false };
}

/** 作品の種類を書く（本体の `writeWorkKind`） */
export async function writeWorkKind(store: FileStore, root: string, kind: WorkKindKey): Promise<SettingsOutcome> {
  return writeConfigFields(store, root, (value) => ({ ...value, kind }));
}

/** 新しくオンにする印で始まる行の場所（「第N話 M行目」）と、読めなかった話の数（数えられなかったことを隠さない） */
export interface MarkedLines {
  places: string[];
  unreadable: number;
}

/** 本文で、新しくオンにする印で始まる行を数える（読むだけ。本体の `findMarkedLines`） */
export async function findMarkedLines(store: FileStore, root: string, added: MemoMarkers): Promise<MarkedLines> {
  const work = await scanWorkFolder(store, root);
  const places: string[] = [];
  let unreadable = 0;
  for (const episode of work.episodes) {
    const path = toStorePath(episode.filePath);
    if (episode.hasConflictMarkers || !path) {
      unreadable += 1;
      continue;
    }
    let text: string;
    try {
      text = (await readTextFile(store, path)).text;
    } catch {
      unreadable += 1;
      continue;
    }
    const label = formatChapterLabel(episode, work.format) || episode.fileName;
    for (const line of linesStartingWithMarkers(text, added)) places.push(`${label} ${line}行目`);
  }
  return { places, unreadable };
}
