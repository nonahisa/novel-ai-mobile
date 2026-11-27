import "../src/platform/bufferShim";
import git from "isomorphic-git";
import { describe, expect, test } from "vitest";
import { MemoryGitFsBackend, createGitFs } from "../src/platform/gitFs";
import { readWorkSync } from "../src/platform/workSync";
import { noteTouched } from "../src/platform/touchedPaths";
import { author } from "./support/fakeGitHub";

/**
 * 1回の読み取りのあいだだけ見たものを覚える置き場（`createGitFs` の `snapshot`。2026-11-27 作者「動作の高速化」）。
 * 作品一覧の「送っていない話の数」で使う。いまの置き場と同じ答えになることと、この置き場から書いたら新しく見ることを確かめる。
 * 作品は作り物（`_確認用`）だけ
 */
const utf8 = (s: string) => new TextEncoder().encode(s);
const BASE = "/works";

async function setup(msPerWrite = 1_000) {
  const backend = new MemoryGitFsBackend(msPerWrite);
  const fs = createGitFs(backend);
  const dir = `${BASE}/灯台守_確認用`;
  await fs.promises.mkdir(BASE);
  await fs.promises.mkdir(dir);
  await git.init({ fs, dir, defaultBranch: "main" });
  for (const folder of ["本文", "設定"]) await fs.promises.mkdir(`${dir}/${folder}`);
  const put = (path: string, text: string) => fs.promises.writeFile(`${dir}/${path}`, utf8(text));
  for (const [path, text] of Object.entries({ "本文/第1話.txt": "一\n", "本文/第2話.txt": "二\n", "設定/characters.json": "{}\n" })) {
    await put(path, text);
    await git.add({ fs, dir, filepath: path });
  }
  await git.commit({ fs, dir, message: "はじめ\n", author, committer: author });
  const both = async () => ({
    plain: await readWorkSync(createGitFs(backend), "灯台守_確認用", BASE),
    snapshot: await readWorkSync(createGitFs(backend, { snapshot: true }), "灯台守_確認用", BASE),
  });
  return { backend, fs, dir, put, both };
}

describe("1回の読み取りのあいだだけ覚える置き場", () => {
  test("そろっている・書き換え・足した・消した・設定の変更で、いまの置き場と同じ答え", async () => {
    const { fs, dir, put, both } = await setup();
    let result = await both();
    expect(result.snapshot).toEqual(result.plain);
    await put("本文/第1話.txt", "一。書き足した\n");
    await put("本文/第3話.txt", "三\n");
    await fs.promises.unlink(`${dir}/本文/第2話.txt`);
    await put("設定/characters.json", '{"a":1}\n');
    result = await both();
    expect(result.snapshot).toEqual(result.plain);
    expect(result.snapshot!.unsent.map((f) => [f.path, f.deleted])).toEqual([
      ["灯台守_確認用/本文/第1話.txt", false],
      ["灯台守_確認用/本文/第2話.txt", true],
      ["灯台守_確認用/本文/第3話.txt", false],
    ]);
    expect(result.snapshot!.otherCount).toBe(1);
  });

  test("同じ秒・同じ大きさの書き換えも、名指しの控えがあれば同じく数える", async () => {
    const { dir, put, fs, both } = await setup(0);
    await put("本文/第1話.txt", "壱\n".padEnd(2, " "));
    await noteTouched(fs, dir, "本文/第1話.txt");
    const result = await both();
    expect(result.snapshot).toEqual(result.plain);
  });

  test("この置き場から書いた場所は、覚えた答えを使わず見直す", async () => {
    const { backend, dir } = await setup();
    const fs = createGitFs(backend, { snapshot: true });
    await fs.promises.readdir(`${dir}/本文`);
    const before = await fs.promises.stat(`${dir}/本文/第1話.txt`);
    await fs.promises.writeFile(`${dir}/本文/第1話.txt`, utf8("ずっと長く書き足した本文\n"));
    const after = await fs.promises.stat(`${dir}/本文/第1話.txt`);
    expect(after.size).not.toBe(before.size);
    await fs.promises.unlink(`${dir}/本文/第1話.txt`);
    await expect(fs.promises.stat(`${dir}/本文/第1話.txt`)).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("覚えない置き場（既定）は毎回見に行く", async () => {
    const { backend, dir } = await setup();
    const fs = createGitFs(backend);
    await fs.promises.readdir(`${dir}/本文`);
    // ほかの道（端末の原稿の置き場）が書いたことにする
    await backend.writeFile(`${dir}/本文/第1話.txt`, utf8("外で長く書き換えた本文\n"));
    expect((await fs.promises.stat(`${dir}/本文/第1話.txt`)).size).toBe(utf8("外で長く書き換えた本文\n").length);
  });
});

describe("isomorphic-git の確かめの読み込み", () => {
  test("場所の無い読み込み（Promise で答えるかの確かめ）は、置き場まで届けずに断る。git の操作は今までどおり", async () => {
    const inner = new MemoryGitFsBackend();
    const asked: string[] = [];
    const backend = new Proxy(inner, {
      get(target, name, receiver) {
        const value = Reflect.get(target, name, receiver);
        if (name !== "readFile") return typeof value === "function" ? value.bind(target) : value;
        return (path: string) => {
          asked.push(String(path));
          return target.readFile(path);
        };
      },
    });
    const fs = createGitFs(backend);
    const probe = (fs.promises.readFile as (path?: string) => Promise<unknown>)();
    expect(probe).toBeInstanceOf(Promise);
    await expect(probe).rejects.toMatchObject({ code: "ENOENT" });
    expect(asked).toEqual([]);
    await fs.promises.mkdir("/r");
    await git.init({ fs, dir: "/r", defaultBranch: "main" });
    expect(await git.resolveRef({ fs, dir: "/r", ref: "HEAD" }).catch((error: { code?: string }) => error.code)).toBe("NotFoundError");
    expect(asked.filter((path) => path === "" || path === "undefined")).toEqual([]);
  });
});

describe("1回の操作のあいだ .git を覚える置き場（steadyGitDir）", () => {
  const counting = () => {
    const inner = new MemoryGitFsBackend();
    const asked: string[] = [];
    const backend = new Proxy(inner, {
      get(target, name, receiver) {
        const value = Reflect.get(target, name, receiver);
        if (name !== "stat") return typeof value === "function" ? value.bind(target) : value;
        return (path: string) => {
          asked.push(path);
          return target.stat(path);
        };
      },
    });
    return { inner, backend, asked };
  };

  test(".git がフォルダーなら2回目からは問い合わせない。原稿と索引は毎回見る", async () => {
    const { backend, asked } = counting();
    const fs = createGitFs(backend, { steadyGitDir: true });
    await fs.promises.mkdir("/r");
    await git.init({ fs, dir: "/r", defaultBranch: "main" });
    await fs.promises.writeFile("/r/a.txt", utf8("一\n"));
    await git.add({ fs, dir: "/r", filepath: "a.txt" });
    // 1回の操作ごとに新しく作る置き場で見る
    const fresh = createGitFs(backend, { steadyGitDir: true });
    asked.length = 0;
    for (let i = 0; i < 3; i++) {
      await fresh.promises.stat("/r/.git");
      await fresh.promises.stat("/r/.git/index");
      await fresh.promises.stat("/r/a.txt");
    }
    expect(asked.filter((path) => path === "/r/.git")).toHaveLength(1);
    expect(asked.filter((path) => path === "/r/.git/index")).toHaveLength(3);
    expect(asked.filter((path) => path === "/r/a.txt")).toHaveLength(3);
  });

  test(".git がファイル（ほかの所を指す書き方）なら覚えない。この置き場から書いたら見直す", async () => {
    const { backend, asked } = counting();
    const fs = createGitFs(backend, { steadyGitDir: true });
    await fs.promises.mkdir("/w");
    await fs.promises.writeFile("/w/.git", utf8("gitdir: /elsewhere\n"));
    await fs.promises.stat("/w/.git");
    await fs.promises.stat("/w/.git");
    expect(asked.filter((path) => path === "/w/.git")).toHaveLength(2);
    await fs.promises.unlink("/w/.git");
    await fs.promises.mkdir("/w/.git");
    expect((await fs.promises.stat("/w/.git")).isDirectory()).toBe(true);
    await fs.promises.rmdir("/w/.git");
    await expect(fs.promises.stat("/w/.git")).rejects.toMatchObject({ code: "ENOENT" });
  });
});
