import { decodeUriEscapes, isPathInside, isUriString } from "novel-ai-assistant/src/core/pathText";
import { normalizeStorePath } from "./fileStore";

/**
 * ファイルの場所（設計書 2.3。本体の `core/paths.ts` の差し替え）。
 *
 * 本体の `paths.ts` は、場所を**文字列のまま**持ち回る（`C:\...` か、ブラウザ版の
 * `vscode-vfs://github/...` のような URI の文字列）。組み立て（`join`・`dirname`・
 * `isPathInside` など）は `pathText.ts` にあり、`vscode` に頼るのは `toUri`・`fromUri` だけ。
 *
 * モバイル版では、場所を **`novelai-device:/works/<作品>/...` という URI の文字列**で持つ。
 *
 * - 本体の `pathText.ts` は URI の文字列を必ず `/` 区切りで扱う。OS のパスの形にすると、
 *   テストを Windows で走らせたときだけ `\` で繋がり、端末と違う答えになる
 * - ブラウザ版の作品（`vscode-vfs:`）と同じ道を通るので、本体がブラウザ版のために
 *   直してきたこと（日本語の符号化・`..` で始まる名前の取り違えなど）がそのまま効く
 *
 * `toUri`・`fromUri` の代わりは `toStorePath`・`fromStorePath`（置き場の相対パスとの往復）。
 * 組み立ては本体の `pathText.ts` をそのまま使う（写さない）。
 */
export * from "novel-ai-assistant/src/core/pathText";

export const DEVICE_SCHEME = "novelai-device";
/** 置き場（`CapacitorFileStore` の根 `works/`）を指す場所 */
export const DEVICE_ROOT = `${DEVICE_SCHEME}:/works`;

/** 置き場の相対パス（`作品/原稿/第1話.txt`）を、持ち回る場所の文字列にする */
export function fromStorePath(storePath: string): string {
  const normalized = normalizeStorePath(storePath);
  if (normalized.split("/").includes("..")) {
    throw new Error(`置き場の外を指しています: ${storePath}`);
  }
  return normalized === "" ? DEVICE_ROOT : `${DEVICE_ROOT}/${normalized}`;
}

/**
 * 持ち回る場所の文字列を、置き場の相対パスへ戻す。
 *
 * **置き場の外は `undefined`**（呼ぶ側が書かずに止める）。パソコンの場所（`C:\...`）・
 * ブラウザ版の場所・`..` で外へ出る場所は、端末では読み書きできない。
 * 外を指す場所を黙って置き場の中へ寄せると、別の話を上書きしうる。
 */
export function toStorePath(location: string): string | undefined {
  if (!isUriString(location)) return undefined;
  const decoded = decodeUriEscapes(location);
  if (decoded === DEVICE_ROOT || decoded === `${DEVICE_ROOT}/`) return "";
  if (!isPathInside(DEVICE_ROOT, decoded)) return undefined;
  const rest = decoded.slice(DEVICE_ROOT.length + 1);
  if (rest.split("/").includes("..")) return undefined;
  return normalizeStorePath(rest);
}
