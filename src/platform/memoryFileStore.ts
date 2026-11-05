import {
  FileExistsError,
  FileNotFoundError,
  dirname,
  normalizeStorePath,
  type FileStore,
} from "./fileStore";

/**
 * 端末を使わない置き場（テスト用）。
 *
 * **端末の置き場と同じ約束を守る**（無いファイルは `FileNotFoundError`、`create` で
 * 在れば `FileExistsError`）。約束が違うと、テストが通っても端末で動かない。
 */
export class MemoryFileStore implements FileStore {
  private readonly files = new Map<string, Uint8Array>();
  private readonly directories = new Set<string>([""]);

  /** テストで、外の道具（パソコンの同期など）が書き換えたことにする */
  putExternally(path: string, bytes: Uint8Array): void {
    const key = normalizeStorePath(path);
    this.ensureParents(key);
    this.files.set(key, bytes.slice());
  }

  /** テストで中身を見る（無ければ `undefined`） */
  peek(path: string): Uint8Array | undefined {
    return this.files.get(normalizeStorePath(path))?.slice();
  }

  async readFile(path: string): Promise<Uint8Array> {
    const bytes = this.files.get(normalizeStorePath(path));
    if (!bytes) throw new FileNotFoundError(path);
    return bytes.slice();
  }

  async writeFile(path: string, bytes: Uint8Array, _options: { mode: "create" }): Promise<void> {
    const key = normalizeStorePath(path);
    if (this.files.has(key)) throw new FileExistsError(path);
    if (!this.directories.has(dirname(key))) throw new FileNotFoundError(dirname(key));
    this.files.set(key, bytes.slice());
  }

  async deleteFile(path: string): Promise<void> {
    const key = normalizeStorePath(path);
    if (!this.files.delete(key)) throw new FileNotFoundError(path);
  }

  async createDirectory(path: string): Promise<void> {
    this.ensureParents(`${normalizeStorePath(path)}/_`);
  }

  async listFiles(path: string): Promise<string[]> {
    const key = normalizeStorePath(path);
    if (!this.directories.has(key)) throw new FileNotFoundError(path);
    const prefix = key === "" ? "" : `${key}/`;
    return [...this.files.keys()]
      .filter((file) => file.startsWith(prefix) && !file.slice(prefix.length).includes("/"))
      .map((file) => file.slice(prefix.length));
  }

  private ensureParents(filePath: string): void {
    const parts = filePath.split("/");
    parts.pop();
    for (let i = 0; i <= parts.length; i += 1) {
      this.directories.add(parts.slice(0, i).join("/"));
    }
  }
}
