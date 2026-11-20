import { AIWRITER_DIR, CONFIG_FILE, detectJsonFileFormat, formatJsonForFile, isPlainFolderName, parseSeriesConfig } from "../shared";
import { FileNotFoundError, joinStorePath, type FileStore } from "./fileStore";
import { readTextFile, writeTextFilePreservingFormat } from "./textFile";
import { findWorkRoots, readWorkLayout } from "./workScan";

/**
 * **作品の長押し → シリーズ：つなぐ・外す**（2026-11-20 夜 作者の答え「つなぐ・外すまで」。本体の `features/setSeries.ts`、
 * 本体の設計書 6.95）。
 *
 * - つなぐ相手は**同じ置き場に並ぶほかの作品**（自分と同じ親の下）。設定ファイルの `series.related` には**フォルダー名**を書く
 *   （場所を書くと、同期した先の機械で壊れる。本体と同じ）
 * - 呼び名は作者が書く（推さない。本体の 6.95.4）。つないであれば今の呼び名を初めに置く
 * - 全部外すと `series` を消す（つながりを解く）
 * - **片方向**：自分の設定ファイルだけを書き、相手の設定ファイルは触らない（本体と同じ）
 * - 書き換えは `writeTextFilePreservingFormat`（読んだあとで変わっていたら書かない・元を退避・改行の形を保つ）。ほかの欄は変えない
 * - 設定ファイルが無い・壊れている作品では、つながない（本体と同じく止める）
 */
export interface SeriesNeighbor {
  folderName: string;
  title: string;
}

export interface WorkSeries {
  name: string;
  related: string[];
}

function split(root: string): { parent: string; self: string } {
  const at = root.lastIndexOf("/");
  return at < 0 ? { parent: "", self: root } : { parent: root.slice(0, at), self: root.slice(at + 1) };
}

/** 隣に並ぶほかの作品（題つき。題の順） */
export async function seriesNeighbors(store: FileStore, root: string): Promise<SeriesNeighbor[]> {
  const { parent, self } = split(root);
  const out: SeriesNeighbor[] = [];
  for (const other of await findWorkRoots(store)) {
    const side = split(other);
    if (side.parent !== parent || side.self === self || !isPlainFolderName(side.self)) continue;
    const title = await readWorkLayout(store, other).then((layout) => layout.title).catch(() => side.self);
    out.push({ folderName: side.self, title });
  }
  return out.sort((a, b) => a.title.localeCompare(b.title, "ja"));
}

export type SeriesRead = { kind: "ok"; series: WorkSeries | undefined } | { kind: "failed"; message: string };

const CONFIG_MISSING = "作品の設定ファイルが無いので、つなげません（先に［題を変える］で題を決めると作られます）";
const CONFIG_BROKEN = "作品の設定ファイルを読めないので、つなげません";

export async function readWorkSeries(store: FileStore, root: string): Promise<SeriesRead> {
  try {
    const { text } = await readTextFile(store, joinStorePath(root, AIWRITER_DIR, CONFIG_FILE));
    const value = JSON.parse(text) as unknown;
    if (typeof value !== "object" || value === null || Array.isArray(value)) return { kind: "failed", message: CONFIG_BROKEN };
    return { kind: "ok", series: parseSeriesConfig((value as Record<string, unknown>).series) };
  } catch (error) {
    return { kind: "failed", message: error instanceof FileNotFoundError ? CONFIG_MISSING : CONFIG_BROKEN };
  }
}

/** つなぐ（`series` を書く）・解く（undefined で `series` を消す） */
export async function writeWorkSeries(store: FileStore, root: string, series: WorkSeries | undefined): Promise<{ ok: true } | { ok: false; message: string }> {
  const configPath = joinStorePath(root, AIWRITER_DIR, CONFIG_FILE);
  let existing;
  let value: Record<string, unknown>;
  try {
    existing = await readTextFile(store, configPath);
    const parsed = JSON.parse(existing.text) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return { ok: false, message: CONFIG_BROKEN };
    value = { ...(parsed as Record<string, unknown>) };
  } catch (error) {
    return { ok: false, message: error instanceof FileNotFoundError ? CONFIG_MISSING : CONFIG_BROKEN };
  }
  if (series) value.series = { name: series.name, related: series.related };
  else delete value.series;
  const text = formatJsonForFile(value, detectJsonFileFormat(await store.readFile(configPath)));
  const written = await writeTextFilePreservingFormat(store, configPath, text, existing, existing.hash);
  if (!written.ok) {
    return { ok: false, message: written.reason === "modified_externally" ? "読んだあとで作品の設定ファイルが変わったので、書きませんでした" : "作品の設定ファイルに書けませんでした" };
  }
  return { ok: true };
}
