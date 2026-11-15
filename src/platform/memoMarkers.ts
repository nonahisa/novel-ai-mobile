import { DEFAULT_MEMO_MARKERS, memoMarkersOfConfigText, type MemoMarkers } from "../shared";
import { FileNotFoundError, joinStorePath, type FileStore } from "./fileStore";

/**
 * **作品のメモの印を読む**（本体 1.0.1〜。本体の設計書 6.40.8・作者の決定 2026-11-14 夜「メモの印を作品ごとに選べる」）。
 *
 * 作品の `.aiwriter/config.json` の `memoMarkers`（`slash`＝`//`・`／／`、`backslash`＝`\`、`percent`＝`%%`、
 * `comment`＝`<!-- -->`）を読み、字数・投稿・書き出しへ渡す印の組にする。解釈は本体の `memoMarkersOfConfigText`
 * をそのまま使う（写さない）。
 *
 * - 設定のファイルが無い → 既定（`//` と `／／`。これまでと同じ）
 * - 読めない・欄が壊れている → 本体と同じく**投げて止める**（`MemoMarkersConfigError`）。黙って既定へ戻すと、
 *   作者が選んだ印の行（`%%` など）が字数と投稿用の写しに出てしまう
 */
export const WORK_CONFIG_PATH = ".aiwriter/config.json";

export async function readWorkMemoMarkers(store: FileStore, workRoot: string): Promise<MemoMarkers> {
  let bytes: Uint8Array;
  try {
    bytes = await store.readFile(joinStorePath(workRoot, WORK_CONFIG_PATH));
  } catch (error) {
    if (error instanceof FileNotFoundError) return DEFAULT_MEMO_MARKERS;
    throw error;
  }
  return memoMarkersOfConfigText(new TextDecoder().decode(bytes));
}
