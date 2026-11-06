import { Directory, Filesystem } from "@capacitor/filesystem";
import { base64ToBytes, bytesToBase64 } from "./capacitorFileStore";

/**
 * isomorphic-git に渡すファイルの口（段0の試作。設計書 6章）。
 *
 * isomorphic-git は Node の `fs.promises` と同じ形の口を受け取る。端末には Node の
 * `fs` が無いので、Capacitor のファイルの読み書きで同じ形を作る。
 *
 * **失敗の種類は `code`（ENOENT など）で伝える。** isomorphic-git は「無い」「もうある」を
 * `code` で見分けて、親フォルダーを作り直したり、無視したりする。Capacitor の失敗の
 * 文言は端末ごとに違うので、文言では見分けない——失敗したら `stat` で確かめ直す
 * （`capacitorFileStore.ts` と同じ考え）。
 *
 * 下の読み書きは `GitFsBackend` に分けた。テストでは手元の入れ物
 * （`MemoryGitFsBackend`）に替えて、isomorphic-git を実際に走らせて確かめる。
 */

export interface GitFsStat {
  type: "file" | "dir";
  size: number;
  mtimeMs: number;
}

/** 下の読み書き。場所は `/` で始まる（isomorphic-git の書き方のまま） */
export interface GitFsBackend {
  readFile(path: string): Promise<Uint8Array>;
  writeFile(path: string, bytes: Uint8Array): Promise<void>;
  unlink(path: string): Promise<void>;
  readdir(path: string): Promise<string[]>;
  /** 親が無ければ ENOENT、もうあれば EEXIST */
  mkdir(path: string): Promise<void>;
  rmdir(path: string): Promise<void>;
  /** 無ければ undefined */
  stat(path: string): Promise<GitFsStat | undefined>;
}

/** Node の失敗と同じ形（`code` を持つ） */
export function fsError(code: "ENOENT" | "EEXIST" | "ENOTDIR" | "ENOTEMPTY" | "EISDIR", path: string): Error {
  return Object.assign(new Error(`${code}: ${path}`), { code });
}

/** isomorphic-git が読む stat の形 */
function toNodeStat(stat: GitFsStat) {
  const isDir = stat.type === "dir";
  return {
    type: stat.type,
    mode: isDir ? 0o40000 : 0o100644,
    size: stat.size,
    ino: 0,
    mtimeMs: stat.mtimeMs,
    ctimeMs: stat.mtimeMs,
    uid: 1,
    gid: 1,
    dev: 1,
    isFile: () => !isDir,
    isDirectory: () => isDir,
    isSymbolicLink: () => false,
  };
}

const utf8 = new TextEncoder();
const utf8Decoder = new TextDecoder();

type ReadOptions = string | { encoding?: string } | undefined;
const wantsText = (options: ReadOptions): boolean =>
  (typeof options === "string" ? options : options?.encoding) === "utf8";

/** isomorphic-git に渡す `fs`（`{ promises }` の形） */
export function createGitFs(backend: GitFsBackend) {
  const statOrThrow = async (path: string) => {
    const stat = await backend.stat(path);
    if (!stat) throw fsError("ENOENT", path);
    return toNodeStat(stat);
  };
  return {
    promises: {
      async readFile(path: string, options?: ReadOptions): Promise<Uint8Array | string> {
        const bytes = await backend.readFile(path);
        return wantsText(options) ? utf8Decoder.decode(bytes) : bytes;
      },
      async writeFile(path: string, data: Uint8Array | string): Promise<void> {
        await backend.writeFile(path, typeof data === "string" ? utf8.encode(data) : data);
      },
      unlink: (path: string) => backend.unlink(path),
      readdir: (path: string) => backend.readdir(path),
      mkdir: (path: string) => backend.mkdir(path),
      rmdir: (path: string) => backend.rmdir(path),
      stat: statOrThrow,
      lstat: statOrThrow,
      /*
        端末のファイルには「別の場所を指すリンク」が無い。isomorphic-git は名前があることを
        前提に読み込むので置いておき、呼ばれたら「無い」と答える（作品フォルダーにリンクは置かない）
      */
      readlink: async (path: string): Promise<never> => {
        throw fsError("ENOENT", path);
      },
      symlink: async (_target: string, path: string): Promise<never> => {
        throw fsError("ENOENT", path);
      },
    },
  };
}

/** 場所の正規化：`/a//b/` → `/a/b` */
export function normalizeGitPath(path: string): string {
  const parts = path.split("/").filter((part) => part !== "" && part !== ".");
  return `/${parts.join("/")}`;
}

const parentOf = (path: string): string => {
  const normalized = normalizeGitPath(path);
  return normalized.slice(0, normalized.lastIndexOf("/")) || "/";
};

/**
 * 端末のファイル（`Directory.Data` の下の `root`）に置く。
 * 原稿の置き場（`CapacitorFileStore` の `works`）と同じ所に置けば、git の作業の木が
 * そのまま作品フォルダーになる。
 */
export class CapacitorGitFsBackend implements GitFsBackend {
  constructor(
    private readonly root = "works",
    private readonly directory = Directory.Data
  ) {}

  private full(path: string): string {
    return `${this.root}${normalizeGitPath(path)}`.replace(/\/$/, "");
  }

  async stat(path: string): Promise<GitFsStat | undefined> {
    try {
      const info = await Filesystem.stat({ path: this.full(path), directory: this.directory });
      return { type: info.type === "directory" ? "dir" : "file", size: info.size, mtimeMs: info.mtime };
    } catch {
      return undefined;
    }
  }

  async readFile(path: string): Promise<Uint8Array> {
    try {
      const result = await Filesystem.readFile({ path: this.full(path), directory: this.directory });
      return typeof result.data === "string"
        ? base64ToBytes(result.data)
        : new Uint8Array(await result.data.arrayBuffer());
    } catch (error) {
      const stat = await this.stat(path);
      if (!stat) throw fsError("ENOENT", path);
      if (stat.type === "dir") throw fsError("EISDIR", path);
      throw error;
    }
  }

  async writeFile(path: string, bytes: Uint8Array): Promise<void> {
    const parent = await this.stat(parentOf(path));
    if (!parent) throw fsError("ENOENT", path);
    await Filesystem.writeFile({ path: this.full(path), directory: this.directory, data: bytesToBase64(bytes) });
  }

  async unlink(path: string): Promise<void> {
    const stat = await this.stat(path);
    if (!stat) throw fsError("ENOENT", path);
    await Filesystem.deleteFile({ path: this.full(path), directory: this.directory });
  }

  async readdir(path: string): Promise<string[]> {
    const stat = await this.stat(path);
    if (!stat) throw fsError("ENOENT", path);
    if (stat.type !== "dir") throw fsError("ENOTDIR", path);
    const result = await Filesystem.readdir({ path: this.full(path), directory: this.directory });
    return result.files.map((file) => file.name);
  }

  async mkdir(path: string): Promise<void> {
    if (await this.stat(path)) throw fsError("EEXIST", path);
    if (!(await this.stat(parentOf(path)))) throw fsError("ENOENT", path);
    try {
      await Filesystem.mkdir({ path: this.full(path), directory: this.directory, recursive: false });
    } catch (error) {
      /*
        isomorphic-git は作業の木を出すとき、同じフォルダーを並んで作りに来る
        （2026-11-06 エミュレーターで踏んだ）。確かめてから作るまでの間に、
        ほかが作り終えていたら「もうある」と答える（isomorphic-git はそれを無視する）
      */
      if (await this.stat(path)) throw fsError("EEXIST", path);
      throw error;
    }
  }

  async rmdir(path: string): Promise<void> {
    const stat = await this.stat(path);
    if (!stat) throw fsError("ENOENT", path);
    if (stat.type !== "dir") throw fsError("ENOTDIR", path);
    const inside = await Filesystem.readdir({ path: this.full(path), directory: this.directory });
    if (inside.files.length > 0) throw fsError("ENOTEMPTY", path);
    await Filesystem.rmdir({ path: this.full(path), directory: this.directory });
  }
}

/**
 * テスト用の手元の入れ物。決まり（ENOENT・EEXIST など）は端末用と同じ。
 *
 * 書いた時刻は、書くたびに `msPerWrite` だけ進む時計で付ける（既定1秒）。0 にすると
 * 「同じ秒のうちに書き換えた」ときを作れる（isomorphic-git が見分けられない場合。`git.test.ts`）。
 */
export class MemoryGitFsBackend implements GitFsBackend {
  private readonly files = new Map<string, Uint8Array>();
  private readonly times = new Map<string, number>();
  private readonly dirs = new Set<string>(["/"]);
  private clock = 1_000;

  constructor(private readonly msPerWrite = 1_000) {}

  async stat(path: string): Promise<GitFsStat | undefined> {
    const key = normalizeGitPath(path);
    if (this.dirs.has(key)) return { type: "dir", size: 0, mtimeMs: 0 };
    const bytes = this.files.get(key);
    return bytes ? { type: "file", size: bytes.length, mtimeMs: this.times.get(key) ?? 0 } : undefined;
  }

  async readFile(path: string): Promise<Uint8Array> {
    const key = normalizeGitPath(path);
    if (this.dirs.has(key)) throw fsError("EISDIR", path);
    const bytes = this.files.get(key);
    if (!bytes) throw fsError("ENOENT", path);
    return bytes.slice();
  }

  async writeFile(path: string, bytes: Uint8Array): Promise<void> {
    const key = normalizeGitPath(path);
    if (!this.dirs.has(parentOf(key))) throw fsError("ENOENT", path);
    if (this.dirs.has(key)) throw fsError("EISDIR", path);
    this.clock += this.msPerWrite;
    this.files.set(key, bytes.slice());
    this.times.set(key, this.clock);
  }

  async unlink(path: string): Promise<void> {
    if (!this.files.delete(normalizeGitPath(path))) throw fsError("ENOENT", path);
  }

  async readdir(path: string): Promise<string[]> {
    const key = normalizeGitPath(path);
    if (this.files.has(key)) throw fsError("ENOTDIR", path);
    if (!this.dirs.has(key)) throw fsError("ENOENT", path);
    const prefix = key === "/" ? "/" : `${key}/`;
    const names = new Set<string>();
    for (const entry of [...this.files.keys(), ...this.dirs]) {
      if (entry !== key && entry.startsWith(prefix)) names.add(entry.slice(prefix.length).split("/")[0]);
    }
    return [...names];
  }

  async mkdir(path: string): Promise<void> {
    const key = normalizeGitPath(path);
    if (this.dirs.has(key) || this.files.has(key)) throw fsError("EEXIST", path);
    if (!this.dirs.has(parentOf(key))) throw fsError("ENOENT", path);
    this.dirs.add(key);
  }

  async rmdir(path: string): Promise<void> {
    const key = normalizeGitPath(path);
    if (!this.dirs.has(key)) throw fsError("ENOENT", path);
    if ((await this.readdir(key)).length > 0) throw fsError("ENOTEMPTY", path);
    this.dirs.delete(key);
  }
}
