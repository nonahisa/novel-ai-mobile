import "../src/platform/bufferShim";
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { MemoryGitFsBackend } from "../src/platform/gitFs";
import {
  IGNORED_PATHS,
  createNewWork,
  createPrivateRepo,
  newWorkConfig,
  newWorkGitignore,
  newWorkResultText,
  repoNameProblem,
} from "../src/platform/newWork";
import type { CloneFn } from "../src/platform/workImport";
import { GitFsFileStore } from "./support/gitFsFileStore";

/** 新しく作る（`src/platform/newWork.ts`。引継ぎ書 75章）。GitHub は偽物、作品は作り物（`_確認用`） */

const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

describe("本体の「本文起点」と同じ形", () => {
  test(".gitignore の除外の一覧は本体の IGNORED_PATHS と同じ（本体が足したら止まる）", () => {
    const source = readFileSync(new URL("../node_modules/novel-ai-assistant/src/core/workRegistry.ts", import.meta.url), "utf8");
    const start = source.indexOf("export const IGNORED_PATHS");
    const body = source
      .slice(start, source.indexOf("];", start))
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    expect([...body.matchAll(/"([^"]+)"/g)].map((m) => m[1])).toEqual([...IGNORED_PATHS]);
    expect(newWorkGitignore().split("\n")[0]).toBe("# 小説AI執筆補助が生成する作業ファイル（再生成できるため同期しない）");
    expect(newWorkGitignore()).toContain(".novelai-recovery/\n");
  });

  test("作品の設定は本体と同じ欄（小説なので種類は書かない）", () => {
    expect(JSON.parse(newWorkConfig("港の灯_確認用", new Date("2026-11-16T12:00:00Z")))).toEqual({
      schemaVersion: "0.1",
      workTitle: "港の灯_確認用",
      manuscriptDir: "本文",
      settingsDir: "設定",
      createdAt: "2026-11-16T12:00:00.000Z",
    });
  });
});

test("リポジトリの名前：英数字と - _ . だけ。日本語・. で始まる・.git で終わるは断る", () => {
  expect(repoNameProblem("minato-kakuninyou")).toBeUndefined();
  expect(repoNameProblem("港")).toContain("英数字");
  expect(repoNameProblem(".hidden")).toContain("「.」で始まる");
  expect(repoNameProblem("work.git")).toContain(".git");
  expect(repoNameProblem("  ")).toBe("名前を入れてください");
});

describe("GitHub に非公開のリポジトリを作る", () => {
  test("非公開・最初の版つきで頼み、合言葉は頭にだけ。同じ名前があれば exists", async () => {
    const calls: Array<{ url: string; body: unknown; auth: string }> = [];
    const result = await createPrivateRepo("tkn", "minato", "港の灯_確認用", async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body), auth: init.headers.Authorization! });
      return { status: 201, json: async () => ({ name: "minato", owner: { login: "sakka" }, private: true, default_branch: "main" }) };
    });
    expect(result).toEqual({ kind: "created", repo: { owner: "sakka", name: "minato", private: true, defaultBranch: "main" } });
    expect(calls).toEqual([{ url: "https://api.github.com/user/repos", body: { name: "minato", description: "港の灯_確認用", private: true, auto_init: true }, auth: "Bearer tkn" }]);
    expect(calls[0]!.url).not.toContain("tkn");
    expect(await createPrivateRepo("tkn", "minato", "", async () => ({ status: 422, json: async () => ({}) }))).toEqual({ kind: "exists" });
    expect(await createPrivateRepo("tkn", "minato", "", async () => ({ status: 401, json: async () => ({}) }))).toEqual({ kind: "failed", reason: "sign_in_again" });
    // 公開で作られていたら、作れたことにしない
    expect(await createPrivateRepo("tkn", "m", "", async () => ({ status: 201, json: async () => ({ name: "m", owner: { login: "s" }, private: false }) }))).toEqual({
      kind: "failed",
      reason: "unknown",
    });
  });
});

describe("新しく作る", () => {
  const fakeRepo = async (_t: string, name: string) => ({ kind: "created" as const, repo: { owner: "sakka", name, private: true, defaultBranch: "main" } });
  const clone: CloneFn = async ({ fs, dir }) => {
    await fs.promises.mkdir(dir);
    await fs.promises.writeFile(`${dir}/README.md`, "# minato\n");
  };

  test("作って取り寄せ、本文起点の形を置く。第1話は空", async () => {
    const backend = new MemoryGitFsBackend();
    const store = new GitFsFileStore(backend);
    const result = await createNewWork({ backend, store, token: "tkn", title: "港の灯_確認用", repoName: "minato", createRepo: fakeRepo, clone, now: new Date("2026-11-16T12:00:00Z") });
    expect(result).toEqual({ kind: "created", root: "minato" });
    expect(JSON.parse(decode(await store.readFile("minato/.aiwriter/config.json"))).workTitle).toBe("港の灯_確認用");
    expect(decode(await store.readFile("minato/.gitignore"))).toBe(newWorkGitignore());
    expect(await store.readFile("minato/本文/001.txt")).toEqual(new Uint8Array());
    expect(decode(await store.readFile("minato/README.md"))).toBe("# minato\n");
  });

  test("端末に同じ名前のフォルダーがあれば、GitHub に作る前に止める（手元を上書きしない）", async () => {
    const backend = new MemoryGitFsBackend();
    await backend.mkdir("/minato");
    let asked = false;
    const result = await createNewWork({
      backend,
      store: new GitFsFileStore(backend),
      token: "tkn",
      title: "t",
      repoName: "minato",
      createRepo: async (...args) => {
        asked = true;
        return fakeRepo(args[0], args[1]);
      },
      clone,
    });
    expect(result).toEqual({ kind: "local_exists" });
    expect(asked).toBe(false);
  });

  test("作れたが取り寄せに失敗したら half（リポジトリは GitHub に残ると知らせる）。名前が使えなければ何もしない", async () => {
    const backend = new MemoryGitFsBackend();
    const failing: CloneFn = async () => {
      throw new TypeError("Failed to fetch");
    };
    const half = await createNewWork({ backend, store: new GitFsFileStore(backend), token: "tkn", title: "t", repoName: "minato", createRepo: fakeRepo, clone: failing });
    expect(half).toEqual({ kind: "half", repo: "sakka/minato", reason: "offline" });
    expect(newWorkResultText(half as Exclude<typeof half, { kind: "created" }>)).toContain("「sakka/minato」はできましたが");
    expect(await createNewWork({ backend, store: new GitFsFileStore(backend), token: "tkn", title: "t", repoName: "港", createRepo: fakeRepo, clone })).toMatchObject({ kind: "bad_name" });
  });
});
