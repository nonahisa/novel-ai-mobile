import { hashBytes, sha256Text } from "novel-ai-assistant/src/core/hash";
import { randomUuid } from "novel-ai-assistant/src/core/runtime";
import { notifyWorkRecordWritten } from "novel-ai-assistant/src/core/workRecordSignal";
import {
  decodeBytes,
  hasConflictMarkers,
  type TextFileContent,
} from "novel-ai-assistant/src/core/textDecode";
import {
  encodePreservingFormat,
  encodeTextFragment,
} from "novel-ai-assistant/src/core/textEncodePreserving";
import { FileExistsError, dirname, joinStorePath, normalizeStorePath, type FileStore } from "./fileStore";

/**
 * 本文の読み書き（設計書 2.3。本体の `core/textFile.ts` の差し替え）。
 *
 * **決まりは本体と同じ**（共通設計書 2.1・本体の CLAUDE.md の実装ルール1「作者の原稿を壊さない」）：
 *
 * - 読んだときのハッシュと今の中身が違えば書かない（外で変わった。`modified_externally`）
 * - 競合の印のある本文は書かない（`conflict_markers`）
 * - 文字コード・改行・変わらなかった所の元のバイトを保つ（本体の `encodePreservingFormat` をそのまま使う）
 * - 書く前の本文を `.novelai-recovery` へ退避し、1ファイル5世代まで残す
 *
 * 本体から借りるのは `vscode` に頼らない部品だけ（`hash`・`runtime`・`textDecode`・
 * `textEncodePreserving`）。**手順は本体の `writeTextFilePreservingFormat` を写して並べ直した**
 * ——本体の関数は `vscode.workspace.fs` を直に呼ぶので借りられない。本体の手順が変わったら、
 * ここも同じに直す（`docs/引継ぎ書.md` 2章の7）。
 *
 * 本体と違うところ：
 * - 「VS Code で開いていて保存していない」（`unsaved_changes`）の確かめは無い。モバイル版の
 *   原稿エディターは自分で書きかけを持つので、書く前に自分で保存を済ませる
 * - 校閲中の話の関所（`setBodyWriteGuard`）は、編集部（段4）を作るときに足す
 */

export type { TextFileContent };

export const RECOVERY_DIRECTORY_NAME = ".novelai-recovery";
export const RECOVERY_GENERATIONS_PER_FILE = 5;

export type WriteTextFailureReason =
  | "modified_externally"
  | "path_conflict"
  | "conflict_markers"
  | "encoding_error";

export type WriteTextFileResult =
  | { ok: true; recoveryPath: string }
  | { ok: false; reason: WriteTextFailureReason; detail?: string; recoveryPaths?: string[] };

export async function readTextFile(store: FileStore, filePath: string): Promise<TextFileContent> {
  return decodeBytes(await store.readFile(filePath));
}

/**
 * 読み込み時と同じ形式で書き戻す。
 *
 * @param expectedHash 読み込み時のハッシュ（`readTextFile` の `hash`）
 */
export async function writeTextFilePreservingFormat(
  store: FileStore,
  filePath: string,
  newText: string,
  original: Pick<TextFileContent, "encoding" | "eol" | "hasTrailingNewline">,
  expectedHash: string,
  options: { rewriteEol?: boolean } = {}
): Promise<WriteTextFileResult> {
  if (hasConflictMarkers(newText)) return { ok: false, reason: "conflict_markers" };

  let current: Uint8Array;
  try {
    current = await store.readFile(filePath);
  } catch {
    // 消えているのも外で変わったとみなす（本体と同じ）
    return { ok: false, reason: "modified_externally" };
  }
  if (decodeBytes(current).hasConflictMarkers) return { ok: false, reason: "conflict_markers" };
  if (hashBytes(current) !== expectedHash) return { ok: false, reason: "modified_externally" };

  const bytes = encodePreservingFormat(current, newText, original, {
    rewriteEol: options.rewriteEol === true,
  });
  // Shift_JIS で表せない字が入った。代わりの字に置き換えて「保存できた」にすると本文が壊れる
  if (!bytes) return { ok: false, reason: "encoding_error" };

  let recoveryPath: string;
  try {
    recoveryPath = await createRecoveryPath(store, filePath);
  } catch (error) {
    return { ok: false, reason: "path_conflict", detail: `回復先を準備できませんでした: ${describe(error)}` };
  }

  // 退避の直前にもう一度確かめる（ここまでの間に外で書き換えられた隙を狭める。本体と同じ）
  let recheck: Uint8Array;
  try {
    recheck = await store.readFile(filePath);
  } catch {
    return { ok: false, reason: "modified_externally" };
  }
  if (hashBytes(recheck) !== expectedHash) return { ok: false, reason: "modified_externally" };

  try {
    await store.writeFile(recoveryPath, recheck, { mode: "create" });
  } catch (error) {
    return { ok: false, reason: "path_conflict", detail: `回復先へコピーできませんでした: ${describe(error)}` };
  }

  try {
    await store.deleteFile(filePath);
  } catch {
    // 元の原稿にはまだ触れていない
    return { ok: false, reason: "modified_externally" };
  }

  try {
    await store.writeFile(filePath, bytes, { mode: "create" });
  } catch (error) {
    const detail = error instanceof FileExistsError ? "同じ名前のファイルが先に作られました" : describe(error);
    return {
      ok: false,
      reason: "path_conflict",
      detail: `元の原稿は「${recoveryPath}」に退避されています。${detail}`,
      recoveryPaths: [recoveryPath],
    };
  }

  await pruneRecoveries(store, filePath);
  // 本体 0.130 から：退避の写しが1つ増えたことを知らせる（本体ではタイムラインの欄が聞く。
  // モバイル版にはまだ聞き手がいないが、手順は本体とそろえる。引継ぎ書 2章の7）
  notifyWorkRecordWritten(filePath);
  return { ok: true, recoveryPath };
}

/**
 * 新しいファイルとして書き出すためのバイト列（本体の `encodeForNewFile` と同じ。競合で「両方残す」に使う）。
 *
 * 本体の関数は `vscode` に頼る `textFile.ts` の中にあるので借りられず、ここに同じものを置く。
 * **元のファイルと同じ文字コード・改行で書く**（片方だけ UTF-8・LF になると、見比べたとき全行が違って見える）。
 * Shift_JIS で表せない字があれば `undefined`（代わりの字に置き換えると本文が壊れる）。
 */
export function encodeForNewFile(
  text: string,
  original: Pick<TextFileContent, "encoding" | "eol" | "hasTrailingNewline">
): Uint8Array | undefined {
  let normalized = text.replace(/\r\n?/g, "\n");
  if (original.hasTrailingNewline && !normalized.endsWith("\n")) {
    normalized += "\n";
  } else if (!original.hasTrailingNewline) {
    normalized = normalized.replace(/\n+$/, "");
  }
  const body = encodeTextFragment(normalized.replace(/\n/g, original.eol), original.encoding);
  if (!body) return undefined;
  if (original.encoding !== "utf8-bom") return body;
  const withBom = new Uint8Array(body.length + 3);
  withBom.set([0xef, 0xbb, 0xbf]);
  withBom.set(body, 3);
  return withBom;
}

let recoverySequence = 0;

/**
 * 退避先の名前。形は本体の `atomicWrite.ts` と同じ（`<鍵>-<13桁の時刻>-<8桁の連番>-<UUID>.bak`）。
 * 鍵は本体ではパスを比べやすく整えてから取る（`normalizeForComparison`。Windows の大文字小文字を
 * 寄せる）。モバイル版の置き場は大文字小文字を区別するので、`/` にそろえたパスから取る。
 * 退避のフォルダーは端末の中だけのもので、パソコンの退避と混ざらない。
 */
async function createRecoveryPath(store: FileStore, filePath: string): Promise<string> {
  const directory = recoveryDirectoryFor(filePath);
  await store.createDirectory(directory);
  recoverySequence += 1;
  const timestamp = String(Date.now()).padStart(13, "0");
  const sequence = String(recoverySequence).padStart(8, "0");
  return joinStorePath(directory, `${recoveryKey(filePath)}-${timestamp}-${sequence}-${randomUuid()}.bak`);
}

async function pruneRecoveries(store: FileStore, filePath: string): Promise<void> {
  const directory = recoveryDirectoryFor(filePath);
  const pattern = new RegExp(
    `^${recoveryKey(filePath)}-\\d{13}-\\d{8}-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.bak$`,
    "i"
  );
  let names: string[];
  try {
    names = await store.listFiles(directory);
  } catch {
    return;
  }
  const obsolete = names
    .filter((name) => pattern.test(name))
    .sort((left, right) => right.localeCompare(left))
    .slice(RECOVERY_GENERATIONS_PER_FILE);
  for (const name of obsolete) {
    try {
      await store.deleteFile(joinStorePath(directory, name));
    } catch {
      // 退避の片付けに失敗しても、済んだ保存を失敗にしない（本体と同じ）
    }
  }
}

function recoveryDirectoryFor(filePath: string): string {
  return joinStorePath(dirname(filePath), RECOVERY_DIRECTORY_NAME);
}

function recoveryKey(filePath: string): string {
  return sha256Text(normalizeStorePath(filePath));
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
