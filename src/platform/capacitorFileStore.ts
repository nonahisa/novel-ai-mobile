import { Directory, Filesystem } from "@capacitor/filesystem";
import {
  FileExistsError,
  FileNotFoundError,
  normalizeStorePath,
  type FileStore,
} from "./fileStore";

/**
 * 端末の置き場：アプリ専用の領域（`Directory.Data`）の下（設計書 2.3。README「先に潰すべき問題」b）。
 *
 * **バイト列のまま読み書きする。** `encoding` を渡すと Capacitor が UTF-8 として読み書きし、
 * Shift_JIS の原稿や改行の形が変わる。文字コードの判定と保持は本体の部品（`textDecode`・
 * `textEncodePreserving`）がするので、ここでは base64 で生のバイトを運ぶだけにする。
 *
 * 【確かめる】端末での読み書きは、まだ実機でもエミュレーターでも通していない（テストは
 * `memoryFileStore.ts` で同じ手順を通しただけ）。
 */
export class CapacitorFileStore implements FileStore {
  constructor(private readonly root = "works", private readonly directory = Directory.Data) {}

  async readFile(path: string): Promise<Uint8Array> {
    let data: string | Blob;
    try {
      ({ data } = await Filesystem.readFile({ path: this.full(path), directory: this.directory }));
    } catch (error) {
      if (await this.missing(path)) throw new FileNotFoundError(path);
      throw error;
    }
    // ブラウザ（段階1・2）では Blob、端末では base64 の文字列で返る
    if (typeof data !== "string") return new Uint8Array(await data.arrayBuffer());
    return base64ToBytes(data);
  }

  async writeFile(path: string, bytes: Uint8Array, _options: { mode: "create" }): Promise<void> {
    // Capacitor の書き込みには「無いときだけ」が無い。直前に確かめる（本体の `create` と同じ約束にそろえる）。
    // 確かめてから書くまでの間に別の道から書かれる隙は残る——モバイル版ではこの領域へ書くのはアプリだけ
    if (!(await this.missing(path))) throw new FileExistsError(path);
    await Filesystem.writeFile({
      path: this.full(path),
      directory: this.directory,
      data: bytesToBase64(bytes),
      recursive: false,
    });
  }

  async deleteFile(path: string): Promise<void> {
    if (await this.missing(path)) throw new FileNotFoundError(path);
    await Filesystem.deleteFile({ path: this.full(path), directory: this.directory });
  }

  async createDirectory(path: string): Promise<void> {
    try {
      await Filesystem.mkdir({ path: this.full(path), directory: this.directory, recursive: true });
    } catch (error) {
      // 在るときも失敗が返る。在るなら目的は果たしている
      const stat = await Filesystem.stat({ path: this.full(path), directory: this.directory }).catch(
        () => undefined
      );
      if (stat?.type !== "directory") throw error;
    }
  }

  async listFiles(path: string): Promise<string[]> {
    try {
      const { files } = await Filesystem.readdir({ path: this.full(path), directory: this.directory });
      return files.filter((file) => file.type === "file").map((file) => file.name);
    } catch (error) {
      if (await this.missing(path)) throw new FileNotFoundError(path);
      throw error;
    }
  }

  private full(path: string): string {
    return normalizeStorePath(`${this.root}/${path}`);
  }

  private async missing(path: string): Promise<boolean> {
    try {
      await Filesystem.stat({ path: this.full(path), directory: this.directory });
      return false;
    } catch {
      return true;
    }
  }
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
