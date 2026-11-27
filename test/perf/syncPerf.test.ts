import "../../src/platform/bufferShim";
import git from "isomorphic-git";
import { describe, it } from "vitest";
import { MemoryGitFsBackend, createGitFs, type GitFsBackend, type GitFsStat } from "../../src/platform/gitFs";
import { readWorkSync } from "../../src/platform/workSync";
import { author } from "../support/fakeGitHub";

/**
 * 速さの測り：作品一覧の「送っていない話の数」（`readWorkSync`）。`PERF=1` のときだけ走る。
 * 端末の git の置き場（`CapacitorGitFsBackend`）は1回ごとにアプリの中の口を往復するので、`PERF_LATENCY` ms の遅れでまねる。
 * 流し方：`PERF=1 npx vitest run test/perf --silent=false`
 */
const LATENCY = Number(process.env.PERF_LATENCY ?? 3);
const run = process.env.PERF === "1" ? it : it.skip;
const utf8 = (s: string) => new TextEncoder().encode(s);
const BASE = "/works";

class SlowBackend implements GitFsBackend {
  calls: Record<string, number> = {};
  slow = false;
  constructor(private readonly inner: GitFsBackend) {}
  private async wait<T>(kind: string, work: () => Promise<T>): Promise<T> {
    if (this.slow) {
      this.calls[kind] = (this.calls[kind] ?? 0) + 1;
      await new Promise((resolve) => setTimeout(resolve, LATENCY));
    }
    return work();
  }
  readFile(path: string) {
    return this.wait("readFile", () => this.inner.readFile(path));
  }
  writeFile(path: string, bytes: Uint8Array) {
    return this.wait("writeFile", () => this.inner.writeFile(path, bytes));
  }
  unlink(path: string) {
    return this.wait("unlink", () => this.inner.unlink(path));
  }
  readdir(path: string) {
    return this.wait("readdir", () => this.inner.readdir(path));
  }
  mkdir(path: string) {
    return this.wait("mkdir", () => this.inner.mkdir(path));
  }
  rmdir(path: string) {
    return this.wait("rmdir", () => this.inner.rmdir(path));
  }
  /** 端末の置き場と同じく、フォルダーの確かめ（stat）と一覧（readdir）の2回として数える */
  async readdirStats(path: string) {
    await this.wait("stat", async () => undefined);
    return this.wait("readdir", () => this.inner.readdirStats!(path));
  }
  paths: string[] = [];
  stat(path: string): Promise<GitFsStat | undefined> {
    if (this.slow) this.paths.push(path);
    return this.wait("stat", () => this.inner.stat(path));
  }
}

async function repo(episodes: number) {
  const backend = new SlowBackend(new MemoryGitFsBackend(1_000));
  const fs = createGitFs(backend);
  const name = "作品_確認用";
  const dir = `${BASE}/${name}`;
  await fs.promises.mkdir(BASE);
  await fs.promises.mkdir(dir);
  await git.init({ fs, dir, defaultBranch: "main" });
  await fs.promises.mkdir(`${dir}/本文`);
  await fs.promises.mkdir(`${dir}/設定`);
  const body = "姉から手紙が届いた。灯台の灯が、霧の向こうで揺れている。\n".repeat(80);
  for (let e = 1; e <= episodes; e++) {
    await fs.promises.writeFile(`${dir}/本文/第${e}話.txt`, utf8(body));
    await git.add({ fs, dir, filepath: `本文/第${e}話.txt` });
  }
  for (let i = 1; i <= 40; i++) {
    await fs.promises.writeFile(`${dir}/設定/char_${i}.json`, utf8(`{"id":"char_${i}"}`));
    await git.add({ fs, dir, filepath: `設定/char_${i}.json` });
  }
  await git.commit({ fs, dir, message: "はじめ\n", author, committer: author });
  return { backend, fs, name, dir };
}

describe("速さの測り：送っていない話の数", () => {
  run("60話・設定40件の作品。そろっているとき／2話を書き換えたとき", async () => {
    const lines: string[] = [];
    const { backend, fs, name, dir } = await repo(60);
    for (const label of ["そろっている", "2話を書き換えた"]) {
      if (label === "2話を書き換えた") {
        await fs.promises.writeFile(`${dir}/本文/第3話.txt`, utf8("書き換えた。\n"));
        await fs.promises.writeFile(`${dir}/本文/第7話.txt`, utf8("書き換えた。\n"));
      }
      for (const snapshot of [false, true]) {
        backend.calls = {};
        backend.paths = [];
        backend.slow = true;
        const start = performance.now();
        const state = await readWorkSync(snapshot ? createGitFs(backend, { snapshot: true }) : fs, name, BASE);
        const ms = performance.now() - start;
        backend.slow = false;
        const total = Object.values(backend.calls).reduce((a, b) => a + b, 0);
        lines.push(`${snapshot ? "写しあり" : "いまの形"}・${label}：${ms.toFixed(0)}ms（呼び出し ${total}：${JSON.stringify(backend.calls)}）送っていない ${state?.unsent.length}`);
      }
    }
    const seen = new Map<string, number>();
    for (const p of backend.paths) seen.set(p, (seen.get(p) ?? 0) + 1);
    if (process.env.PERF_PATHS) lines.push(JSON.stringify([...seen].filter(([, n]) => n > 2).slice(0, 5)), JSON.stringify(backend.paths.slice(0, 12)));
    process.stdout.write(["[測り] 遅れ " + LATENCY + "ms", ...lines, ""].join("\n"));
  }, 300_000);
});
