import {
  AIWRITER_DIR,
  CONFIG_FILE,
  CONFIG_SCHEMA_VERSION,
  MEMO_MARKER_IDS,
  detectJsonFileFormat,
  formatChapterLabel,
  formatJsonForFile,
  linesStartingWithMarkers,
  memoMarkersOf,
  parseWorkKind,
  resolveWorkKind,
  PLOT_FILE,
  matchWorkFormat,
  parsePlotMarkdown,
  updatePlotMarkdown,
  type MemoMarkerId,
  type MemoMarkers,
  type PlotSections,
  type WorkKindKey,
} from "../shared";
import { FileExistsError, FileNotFoundError, joinStorePath, type FileStore } from "./fileStore";
import { toStorePath } from "./paths";
import { readTextFile, writeTextFilePreservingFormat, type TextFileContent } from "./textFile";
import { readFormat, readWorkLayout, scanWorkFolder } from "./workScan";
import { ledgerShapeProblem } from "./ledgerShapeGate";

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
  // モバイル版の知らない新しい形なら書かない（2026-11-21 作者の答え「台帳の形が変わったときだけ止める」）
  const newer = ledgerShapeProblem("作品の設定", loaded.content.text, CONFIG_SCHEMA_VERSION);
  if (newer) return { ok: false, message: newer };
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

/**
 * **形式・ジャンル**（本体の `features/setPlotBasics.ts`・`core/plotFile.ts` の `writePlotSections`）。在り処はプロット（`設定/plot.md`）の
 * `## 形式`・`## ジャンル`。**作者の文書なので、ほかの節・作者が立てた見出しには触れない**（本体の `updatePlotMarkdown`）。
 * ジャンルを決めないまま進んだときは、**書いてあるジャンルを消さない**（空で上書きしない）。
 * 形式が「脚本」だった作品は、形式を書き換える前に種類「台本」を作品の設定へ書き留める（本体の `keepScriptKind`。
 * 種類の軸ができる前の作品で、読み替えの根拠が消えて台本の組み方が黙って外れるのを防ぐ。書けなくても形式の決め直しは続ける）
 */
export async function readPlotSections(store: FileStore, root: string): Promise<{ sections: PlotSections; title: string }> {
  const layout = await readWorkLayout(store, root);
  try {
    const plot = await readTextFile(store, joinStorePath(layout.settings, PLOT_FILE));
    return { sections: parsePlotMarkdown(plot.text).sections, title: layout.title };
  } catch (error) {
    if (error instanceof FileNotFoundError) return { sections: parsePlotMarkdown("").sections, title: layout.title };
    throw error;
  }
}

export async function writePlotBasics(store: FileStore, root: string, format: string, genres: string | undefined): Promise<SettingsOutcome> {
  let layout;
  try {
    layout = await readWorkLayout(store, root);
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
  const path = joinStorePath(layout.settings, PLOT_FILE);
  let existing: TextFileContent | undefined;
  try {
    existing = await readTextFile(store, path);
  } catch (error) {
    if (!(error instanceof FileNotFoundError)) return { ok: false, message: "プロット（plot.md）を読めませんでした" };
  }
  const current = existing ? existing.text.replace(/\r\n?/g, "\n") : "";
  // 書き換える前に、形式が「脚本」だった作品の種類を書き留める（設定に種類が書かれていれば何もしない）
  if (matchWorkFormat(parsePlotMarkdown(current).sections.format) === "script") {
    const kind = await readWorkKindOf(store, root);
    if (!kind.configured) await writeWorkKind(store, root, "script").catch(() => undefined);
  }
  const updates: Partial<PlotSections> = { format, ...(genres ? { genre: genres } : {}) };
  const next = updatePlotMarkdown(current, updates, { workTitle: layout.title });
  if (existing) {
    if (next === current) return { ok: true };
    const written = await writeTextFilePreservingFormat(store, path, next, existing, existing.hash);
    if (!written.ok) {
      return {
        ok: false,
        message: written.reason === "modified_externally" ? "読んだあとでプロットが変わったので、書きませんでした。同期のあとでもう一度" : "プロット（plot.md）に書けませんでした",
      };
    }
    return { ok: true };
  }
  try {
    await store.createDirectory(layout.settings);
    await store.writeFile(path, new TextEncoder().encode(next), { mode: "create" });
    return { ok: true };
  } catch (error) {
    return { ok: false, message: error instanceof FileExistsError ? "プロットが外でできたので、書きませんでした。同期のあとでもう一度" : "プロット（plot.md）を作れませんでした" };
  }
}
