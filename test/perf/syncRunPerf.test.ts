import "../../src/platform/bufferShim";
import git from "isomorphic-git";
import { describe, expect, it } from "vitest";
import { MemoryGitFsBackend, createGitFs, type GitFsBackend, type GitFsStat } from "../../src/platform/gitFs";
import { fetchWork, githubIdentity, sendWork } from "../../src/platform/workSyncRun";
import { FakeGitHub, author } from "../support/fakeGitHub";
import { GitFsFileStore } from "../support/gitFsFileStore";

/**
 * 速さの測り：同期の［送る］［取ってくる］（`workSyncRun.ts`）。`PERF=1` のときだけ走る。
 * 端末の git の置き場は1回ごとにアプリの中の口を往復するので、`PERF_LATENCY` ms の遅れでまねる。GitHub は偽物で遅れは足さない
 * （通信の速さは端末の外の話。ここで見るのは端末の中の手間）。流し方：`PERF=1 npx vitest run test/perf --silent=false`
 */
const NL = String.fromCharCode(10);
const LATENCY = Number(process.env.PERF_LATENCY ?? 3);
const run = process.env.PERF === "1" ? it : it.skip;
const utf8 = (s: string) => new TextEncoder().encode(s);
const BASE = "/works";
const WORK = "作品_確認用";
const DIR = `${BASE}/${WORK}`;

class SlowBackend implements GitFsBackend {
  calls: Record<string, number> = {};
  slow = false;
  constructor(private readonly inner: MemoryGitFsBackend) {}
  byPath = new Map<string, number>();
  private async wait<T>(kind: string, work: () => Promise<T>, path = ""): Promise<T> {
    if (this.slow) {
      const key = `${kind} ${path.replace(/[0-9a-f]{38}$/, "<物>").replace(/第\d+話/, "第N話").replace(/char_\d+/, "char_N")}`;
      this.byPath.set(key, (this.byPath.get(key) ?? 0) + 1);
      if (process.env.PERF_DEBUG && kind === "readFile" && this.byPath.get(key)! < 3) process.stdout.write(`DBG [${String(path).slice(-60)}] ${path === "" ? (new Error().stack ?? "").split(NL).slice(2, 7).join(" / ") : ""}` + NL);
      this.calls[kind] = (this.calls[kind] ?? 0) + 1;
      await new Promise((resolve) => setTimeout(resolve, LATENCY));
    }
    return work();
  }
  readFile(path: string) {
    return this.wait("readFile", () => this.inner.readFile(path), path);
  }
  writeFile(path: string, bytes: Uint8Array) {
    return this.wait("writeFile", () => this.inner.writeFile(path, bytes));
  }
  unlink(path: string) {
    return this.wait("unlink", () => this.inner.unlink(path), path);
  }
  readdir(path: string) {
    return this.wait("readdir", () => this.inner.readdir(path), path);
  }
  /** 端末の置き場と同じく、フォルダーの確かめ（stat）と一覧（readdir）の2回として数える */
  async readdirStats(path: string) {
    await this.wait("stat", async () => undefined);
    return this.wait("readdir", () => this.inner.readdirStats(path));
  }
  mkdir(path: string) {
    return this.wait("mkdir", () => this.inner.mkdir(path), path);
  }
  rmdir(path: string) {
    return this.wait("rmdir", () => this.inner.rmdir(path), path);
  }
  stat(path: string): Promise<GitFsStat | undefined> {
    return this.wait("stat", () => this.inner.stat(path), path);
  }
}

const body = (n: number) => `第${n}話。姉から手紙が届いた。灯台の灯が、霧の向こうで揺れている。\n`.repeat(80);

async function setup(episodes = 60, steady = false) {
  const files: Record<string, string> = {};
  for (let e = 1; e <= episodes; e++) files[`本文/第${e}話.txt`] = body(e);
  for (let i = 1; i <= 40; i++) files[`設定/char_${i}.json`] = `{"id":"char_${i}"}\n`;
  const gh = new FakeGitHub();
  const remote = await gh.init(files);
  const backend = new SlowBackend(new MemoryGitFsBackend(1_000));
  const fs = createGitFs(backend);
  await fs.promises.mkdir(BASE);
  await fs.promises.mkdir(DIR);
  await git.init({ fs, dir: DIR, defaultBranch: "main" });
  for (const folder of ["本文", "設定"]) await fs.promises.mkdir(`${DIR}/${folder}`);
  for (const [path, s] of Object.entries(files)) {
    await fs.promises.writeFile(`${DIR}/${path}`, utf8(s));
    await git.add({ fs, dir: DIR, filepath: path });
  }
  expect(await git.commit({ fs, dir: DIR, message: "はじめ\n", author, committer: author })).toBe(remote.commit);
  await git.setConfig({ fs, dir: DIR, path: "remote.origin.url", value: "https://github.com/sakka/toudai.git" });
  // 測る操作は、端末と同じく1回ごとに作る置き場で（steady なら .git を覚える）。取得も同じ置き場で
  const opFs = createGitFs(backend, steady ? { steadyGitDir: true } : {});
  const copyCommit = async (oid: string) => {
    const { commit } = await git.readCommit({ fs: gh.fs, dir: gh.dir, oid });
    const walk = async (tree: string) => {
      for (const entry of (await git.readTree({ fs: gh.fs, dir: gh.dir, oid: tree })).tree) {
        if (entry.type === "tree") await walk(entry.oid);
        else await git.writeBlob({ fs: opFs, dir: DIR, blob: (await git.readBlob({ fs: gh.fs, dir: gh.dir, oid: entry.oid })).blob });
      }
      const { object } = await git.readObject({ fs: gh.fs, dir: gh.dir, oid: tree, format: "content" });
      await git.writeObject({ fs: opFs, dir: DIR, type: "tree", object: object as Uint8Array, format: "content" });
    };
    await walk(commit.tree);
    const { object } = await git.readObject({ fs: gh.fs, dir: gh.dir, oid, format: "content" });
    await git.writeObject({ fs: opFs, dir: DIR, type: "commit", object: object as Uint8Array, format: "content" });
  };
  const fetchHead = async () => {
    await copyCommit(gh.head);
    await git.writeRef({ fs: opFs, dir: DIR, ref: "refs/remotes/origin/main", value: gh.head, force: true });
    return gh.head;
  };
  const deps = { fs: opFs, root: WORK, base: BASE, token: "tkn" };
  const store = new GitFsFileStore(backend);
  return {
    gh,
    fs,
    backend,
    send: () => sendWork({ ...deps, author: githubIdentity("sakka", 1234), message: "モバイル版で書いた", fetcher: gh.fetch, apiBase: "https://api.test", adopt: copyCommit }),
    fetch: () => fetchWork({ ...deps, store, storeDir: `works/${WORK}`, fetchHead }),
  };
}

async function measure(backend: SlowBackend, work: () => Promise<unknown>) {
  backend.calls = {};
  backend.slow = true;
  const start = performance.now();
  const outcome = await work();
  const ms = performance.now() - start;
  backend.slow = false;
  const total = Object.values(backend.calls).reduce((a, b) => a + b, 0);
  if (process.env.PERF_PATHS) process.stdout.write([...backend.byPath].sort((x, y) => y[1] - x[1]).slice(0, 14).map(([k, n]) => `  ${n} ${k}`).join(NL) + NL);
  backend.byPath.clear();
  return `${ms.toFixed(0)}ms（呼び出し ${total}：${JSON.stringify(backend.calls)}）→ ${JSON.stringify(outcome)}`;
}

describe("速さの測り：送る・取ってくる", () => {
  run("60話・設定40件。2話を書き換えて送る／向こうで2話書き換えたのを取ってくる", async () => {
    const lines: string[] = [];
    for (const steady of [false, true]) {
      const label = steady ? "（.git を覚える）" : "（いまの形）";
      const a = await setup(60, steady);
      await a.fs.promises.writeFile(`${DIR}/本文/第3話.txt`, utf8("こちらで書き換えた。\n"));
      await a.fs.promises.writeFile(`${DIR}/本文/第7話.txt`, utf8("こちらで書き換えた。\n"));
      lines.push(`送る${label}：${await measure(a.backend, a.send)}`);
      const b = await setup(60, steady);
      await b.gh.commitFiles({ "本文/第4話.txt": "あちらで書き換えた。\n", "本文/第9話.txt": "あちらで書き換えた。\n" });
      lines.push(`取ってくる${label}：${await measure(b.backend, b.fetch)}`);
    }
    process.stdout.write(["[測り] 遅れ " + LATENCY + "ms", ...lines, ""].join("\n"));
  }, 600_000);
});
