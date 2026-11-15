import { FileExistsError, FileNotFoundError, dirname, normalizeStorePath, type FileStore, type WriteMode } from "../../src/platform/fileStore";
import type { GitFsBackend } from "../../src/platform/gitFs";

/**
 * git の置き場（`GitFsBackend`）の上に、本文の置き場（`FileStore`）を重ねる（試験用）。
 * 端末では `CapacitorFileStore` と `CapacitorGitFsBackend` が同じ `works` を指す。試験でも
 * 同じ入れ物を両方から見るために使う。約束は `MemoryFileStore` と同じ。
 */
export class GitFsFileStore implements FileStore {
  constructor(private readonly backend: GitFsBackend) {}

  private key(path: string): string {
    return `/${normalizeStorePath(path)}`;
  }

  async readFile(path: string): Promise<Uint8Array> {
    const stat = await this.backend.stat(this.key(path));
    if (stat?.type !== "file") throw new FileNotFoundError(path);
    return this.backend.readFile(this.key(path));
  }

  async writeFile(path: string, bytes: Uint8Array, options: { mode: WriteMode }): Promise<void> {
    const stat = await this.backend.stat(this.key(path));
    if (options.mode === "overwrite") {
      if (stat?.type !== "file") throw new FileNotFoundError(path);
    } else {
      if (stat) throw new FileExistsError(path);
      if ((await this.backend.stat(this.key(dirname(path))))?.type !== "dir") throw new FileNotFoundError(dirname(path));
    }
    await this.backend.writeFile(this.key(path), bytes);
  }

  async deleteFile(path: string): Promise<void> {
    if ((await this.backend.stat(this.key(path)))?.type !== "file") throw new FileNotFoundError(path);
    await this.backend.unlink(this.key(path));
  }

  async createDirectory(path: string): Promise<void> {
    let current = "";
    for (const part of normalizeStorePath(path).split("/").filter(Boolean)) {
      current = `${current}/${part}`;
      if (!(await this.backend.stat(current))) await this.backend.mkdir(current);
    }
  }

  async listFiles(path: string): Promise<string[]> {
    const key = this.key(path);
    if ((await this.backend.stat(key))?.type !== "dir") throw new FileNotFoundError(path);
    const names: string[] = [];
    for (const name of await this.backend.readdir(key)) {
      if ((await this.backend.stat(`${key === "/" ? "" : key}/${name}`))?.type === "file") names.push(name);
    }
    return names;
  }
}
