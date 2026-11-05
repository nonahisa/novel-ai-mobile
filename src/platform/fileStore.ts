/**
 * ファイルの置き場（設計書 2.3「本文の読み書き」の下の層）。
 *
 * 本体の `core/textFile.ts` は `vscode.workspace.fs` で読み書きする。モバイル版では
 * その下の読み書きだけを差し替え、**上の決まり（ハッシュの照合・文字コードと改行の保持・
 * 退避）は本体と同じ部品で守る**（`textFile.ts`）。
 *
 * 置き場を口（interface）にしてあるのは、テストで端末を使わずに同じ手順を通すためである。
 * 端末では `capacitorFileStore.ts`、テストでは `memoryFileStore.ts` を渡す。
 *
 * パスは置き場の根からの相対パスで、区切りは `/`（作品フォルダーの形は本体と同じ。共通設計書 3.1）。
 */
export interface FileStore {
  /** 読む。無ければ `FileNotFoundError` を投げる */
  readFile(path: string): Promise<Uint8Array>;
  /**
   * 書く。`create` は「無いときだけ作る」——在れば `FileExistsError` を投げる。
   * 本体の `atomicWriteFile(..., { mode: "create" })` と同じ約束で、黙って上書きしない
   */
  writeFile(path: string, bytes: Uint8Array, options: { mode: "create" }): Promise<void>;
  /** 消す。無ければ `FileNotFoundError` を投げる */
  deleteFile(path: string): Promise<void>;
  /** フォルダーを作る（途中のフォルダーも。在ってもよい） */
  createDirectory(path: string): Promise<void>;
  /** フォルダーの中のファイルの名前。フォルダーが無ければ `FileNotFoundError` */
  listFiles(path: string): Promise<string[]>;
}

export class FileNotFoundError extends Error {
  constructor(readonly path: string) {
    super(`ファイルがありません: ${path}`);
    this.name = "FileNotFoundError";
  }
}

export class FileExistsError extends Error {
  constructor(readonly path: string) {
    super(`同じ名前のファイルがすでにあります: ${path}`);
    this.name = "FileExistsError";
  }
}

/** 区切りを `/` にそろえ、`./`・重ねた `/`・末尾の `/` を落とす */
export function normalizeStorePath(path: string): string {
  return path
    .replace(/\\/g, "/")
    .split("/")
    .filter((part) => part !== "" && part !== ".")
    .join("/");
}

export function dirname(path: string): string {
  const parts = normalizeStorePath(path).split("/");
  parts.pop();
  return parts.join("/");
}

export function joinStorePath(...parts: string[]): string {
  return normalizeStorePath(parts.join("/"));
}
