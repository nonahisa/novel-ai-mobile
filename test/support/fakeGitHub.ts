import "../../src/platform/bufferShim";
import git from "isomorphic-git";
import { expect } from "vitest";
import { MemoryGitFsBackend, createGitFs } from "../../src/platform/gitFs";
import { base64ToBytes } from "../../src/platform/capacitorFileStore";
import type { ApiFetch } from "../../src/platform/githubCommitApi";

/**
 * 偽の GitHub（`api.github.com` の git の口のうち、送るのに使う所だけ）。
 * 中に isomorphic-git のリポジトリを持ち、中身・木・版を本物の git の名前（SHA-1）で作る。
 */

export const memoryFs = () => createGitFs(new MemoryGitFsBackend());
export const author = { name: "作者", email: "author@example.invalid", timestamp: 1_700_000_000, timezoneOffset: -540 };
export const text = (s: string) => new TextEncoder().encode(s);

export type Step = "ref" | "base" | "blob" | "tree" | "commit" | "update_ref";

/** 偽の GitHub */
export class FakeGitHub {
  readonly fs = memoryFs();
  readonly dir = "/remote";
  head = "";
  readonly calls: { method: string; path: string }[] = [];
  /** 段ごとに返す状態の番号を差し替える */
  failAt: Partial<Record<Step, number>> = {};
  /** 中身を受け取ったとき、わざと形を変える（改行を CRLF にするなど） */
  mangleBlob?: (bytes: Uint8Array) => Uint8Array;
  /** 枝を進める直前に、もう1台が送ったことにする */
  raceBeforeUpdate?: () => Promise<void>;
  offline = false;

  async init(files: Record<string, string>): Promise<{ commit: string; tree: string }> {
    await this.fs.promises.mkdir(this.dir);
    await git.init({ fs: this.fs, dir: this.dir, defaultBranch: "main" });
    const tree = await this.buildTree(new Map(), Object.entries(files).map(([path, s]) => ({ path, bytes: text(s) })));
    this.head = await git.writeCommit({
      fs: this.fs,
      dir: this.dir,
      commit: { message: "はじめ\n", tree, parent: [], author, committer: author },
    });
    return { commit: this.head, tree };
  }

  /** 枝の今の版の、道 → 中身 */
  async files(): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    const { commit } = await git.readCommit({ fs: this.fs, dir: this.dir, oid: this.head });
    for (const [path, oid] of await this.flatten(commit.tree)) {
      const { blob } = await git.readBlob({ fs: this.fs, dir: this.dir, oid });
      out[path] = new TextDecoder().decode(blob);
    }
    return out;
  }

  private async flatten(tree: string, prefix = "", out = new Map<string, string>()): Promise<Map<string, string>> {
    const { tree: entries } = await git.readTree({ fs: this.fs, dir: this.dir, oid: tree });
    for (const entry of entries) {
      const path = prefix + entry.path;
      if (entry.type === "tree") await this.flatten(entry.oid, `${path}/`, out);
      else out.set(path, entry.oid);
    }
    return out;
  }

  private async buildTree(
    base: Map<string, string>,
    put: { path: string; bytes?: Uint8Array; oid?: string | null }[]
  ): Promise<string> {
    const flat = new Map(base);
    for (const item of put) {
      if (item.oid === null) flat.delete(item.path);
      else if (item.oid) flat.set(item.path, item.oid);
      else flat.set(item.path, await git.writeBlob({ fs: this.fs, dir: this.dir, blob: item.bytes! }));
    }
    const write = async (prefix: string): Promise<string> => {
      const names = new Map<string, { type: "blob" | "tree"; oid?: string }>();
      for (const [path, oid] of flat) {
        if (!path.startsWith(prefix)) continue;
        const rest = path.slice(prefix.length);
        const slash = rest.indexOf("/");
        if (slash < 0) names.set(rest, { type: "blob", oid });
        else names.set(rest.slice(0, slash), { type: "tree" });
      }
      const tree = [];
      for (const [name, entry] of names) {
        const oid = entry.type === "tree" ? await write(`${prefix}${name}/`) : entry.oid!;
        tree.push({ mode: entry.type === "tree" ? "040000" : "100644", path: name, oid, type: entry.type });
      }
      return git.writeTree({ fs: this.fs, dir: this.dir, tree });
    };
    return write("");
  }

  readonly fetch: ApiFetch = async (url, init) => {
    if (this.offline) throw new TypeError("Failed to fetch");
    const path = decodeURIComponent(new URL(url).pathname);
    this.calls.push({ method: init.method, path });
    const body = init.body ? (JSON.parse(init.body) as Record<string, unknown>) : {};
    expect(init.headers.authorization).toBe("Bearer tkn");
    const reply = (status: number, data: unknown = {}) => ({ status, json: async () => data });
    const step: Step | undefined =
      init.method === "GET" && path.includes("/git/ref/")
        ? "ref"
        : init.method === "GET" && path.includes("/git/commits/")
          ? "base"
          : path.endsWith("/git/blobs")
            ? "blob"
            : path.endsWith("/git/trees")
              ? "tree"
              : path.endsWith("/git/commits")
                ? "commit"
                : init.method === "PATCH"
                  ? "update_ref"
                  : undefined;
    if (step && this.failAt[step]) return reply(this.failAt[step]!, { message: "偽の失敗" });

    switch (step) {
      case "ref":
        return reply(200, { object: { sha: this.head } });
      case "base": {
        const oid = path.split("/").pop()!;
        const { commit } = await git.readCommit({ fs: this.fs, dir: this.dir, oid });
        return reply(200, { tree: { sha: commit.tree } });
      }
      case "blob": {
        expect(body.encoding).toBe("base64");
        let bytes = base64ToBytes(body.content as string);
        if (this.mangleBlob) bytes = this.mangleBlob(bytes);
        return reply(201, { sha: await git.writeBlob({ fs: this.fs, dir: this.dir, blob: bytes }) });
      }
      case "tree": {
        const base = await this.flatten(body.base_tree as string);
        const entries = body.tree as { path: string; sha: string | null }[];
        return reply(201, { sha: await this.buildTree(base, entries.map((e) => ({ path: e.path, oid: e.sha }))) });
      }
      case "commit": {
        const sha = await git.writeCommit({
          fs: this.fs,
          dir: this.dir,
          commit: {
            message: body.message as string,
            tree: body.tree as string,
            parent: body.parents as string[],
            // GitHub は自分の時刻を付けうるので、手元の版と名前が変わる形にしておく
            author: { ...author, timestamp: author.timestamp + 99 },
            committer: { ...author, timestamp: author.timestamp + 99 },
          },
        });
        return reply(201, { sha });
      }
      case "update_ref": {
        if (this.raceBeforeUpdate) await this.raceBeforeUpdate();
        expect(body.force).toBe(false);
        const { commit } = await git.readCommit({ fs: this.fs, dir: this.dir, oid: body.sha as string });
        if (!commit.parent.includes(this.head)) return reply(422, { message: "Update is not a fast forward" });
        this.head = body.sha as string;
        return reply(200, { object: { sha: this.head } });
      }
    }
    return reply(404);
  };
}

