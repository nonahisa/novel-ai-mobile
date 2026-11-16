import "../src/platform/bufferShim";
import git, { Errors } from "isomorphic-git";
import { describe, expect, test } from "vitest";
import { MemoryGitFsBackend, createGitFs } from "../src/platform/gitFs";
import {
  fetchFailure,
  fetchWork,
  githubIdentity,
  outcomeText,
  parseGitHubUrl,
  pushMessage,
  readRepoTarget,
  sendWork,
} from "../src/platform/workSyncRun";
import { readWorkSync } from "../src/platform/workSync";
import { FakeGitHub, author } from "./support/fakeGitHub";
import { GitFsFileStore } from "./support/gitFsFileStore";

/**
 * 同期の画面の［取ってくる］［送る］（`src/platform/workSyncRun.ts`。引継ぎ書 59章）。
 * GitHub は偽物（`FakeGitHub`）。作品は作り物（`_確認用`）だけ。合言葉も作り物
 */

const BASE = "/works";
const WORK = "灯台守_確認用";
const DIR = `${BASE}/${WORK}`;
const start = { "本文/第1話 手紙.txt": "一\n", "本文/第2話 灯.txt": "二\n", "設定/characters.json": "{}\n" };
const utf8 = (s: string) => new TextEncoder().encode(s);

async function setup(remoteUrl: string | null = "https://github.com/sakka/toudai.git") {
  const gh = new FakeGitHub();
  const remote = await gh.init(start);
  const backend = new MemoryGitFsBackend(1_000);
  const fs = createGitFs(backend);
  await fs.promises.mkdir(BASE);
  await fs.promises.mkdir(DIR);
  await git.init({ fs, dir: DIR, defaultBranch: "main" });
  for (const [path, s] of Object.entries(start)) {
    await fs.promises.mkdir(`${DIR}/${path.split("/")[0]}`).catch(() => undefined);
    await fs.promises.writeFile(`${DIR}/${path}`, utf8(s));
    await git.add({ fs, dir: DIR, filepath: path });
  }
  expect(await git.commit({ fs, dir: DIR, message: "はじめ\n", author, committer: author })).toBe(remote.commit);
  if (remoteUrl) await git.setConfig({ fs, dir: DIR, path: "remote.origin.url", value: remoteUrl });
  /** 偽の取得：向こうの版の物を手元へ写す */
  const copyCommit = async (oid: string) => {
    const { commit } = await git.readCommit({ fs: gh.fs, dir: gh.dir, oid });
    const walk = async (tree: string) => {
      for (const entry of (await git.readTree({ fs: gh.fs, dir: gh.dir, oid: tree })).tree) {
        if (entry.type === "tree") await walk(entry.oid);
        else {
          const { blob } = await git.readBlob({ fs: gh.fs, dir: gh.dir, oid: entry.oid });
          await git.writeBlob({ fs, dir: DIR, blob });
        }
      }
      const { object } = await git.readObject({ fs: gh.fs, dir: gh.dir, oid: tree, format: "content" });
      await git.writeObject({ fs, dir: DIR, type: "tree", object: object as Uint8Array, format: "content" });
    };
    await walk(commit.tree);
    const { object } = await git.readObject({ fs: gh.fs, dir: gh.dir, oid, format: "content" });
    await git.writeObject({ fs, dir: DIR, type: "commit", object: object as Uint8Array, format: "content" });
  };
  const fetchHead = async () => {
    await copyCommit(gh.head);
    await git.writeRef({ fs, dir: DIR, ref: "refs/remotes/origin/main", value: gh.head, force: true });
    return gh.head;
  };
  const deps = { fs, root: WORK, base: BASE, token: "tkn" };
  const send = (message = "モバイル版で書いた") =>
    sendWork({ ...deps, author: githubIdentity("sakka", 1234), message, fetcher: gh.fetch, apiBase: "https://api.test", adopt: copyCommit });
  const store = new GitFsFileStore(backend);
  const fetch = () => fetchWork({ ...deps, store, storeDir: `works/${WORK}`, fetchHead });
  const read = async (path: string) => new TextDecoder().decode((await fs.promises.readFile(`${DIR}/${path}`)) as Uint8Array);
  return { gh, fs, send, fetch, read };
}

describe("送り先", () => {
  test("GitHub の https・ssh の名前だけを読む。ほかは分からない", () => {
    expect(parseGitHubUrl("https://github.com/sakka/灯台守.git")).toBeUndefined(); // 日本語のリポジトリ名は GitHub に無い
    expect(parseGitHubUrl("https://github.com/sakka/toudai.git")).toEqual({ owner: "sakka", repo: "toudai" });
    expect(parseGitHubUrl("https://github.com/sakka/toudai")).toEqual({ owner: "sakka", repo: "toudai" });
    expect(parseGitHubUrl("git@github.com:sakka/toudai.git")).toEqual({ owner: "sakka", repo: "toudai" });
    expect(parseGitHubUrl("https://x-access-token@github.com/sakka/toudai.git")).toEqual({ owner: "sakka", repo: "toudai" });
    expect(parseGitHubUrl("https://gitlab.com/sakka/toudai.git")).toBeUndefined();
    expect(parseGitHubUrl("https://github.com/sakka/../x")).toBeUndefined();
  });

  test("リポジトリの origin と今の枝。origin が無ければ分からない", async () => {
    const { fs } = await setup("https://github.com/sakka/toudai.git");
    expect(await readRepoTarget(fs, DIR)).toEqual({ owner: "sakka", repo: "toudai", branch: "main" });
    const none = await setup(null);
    expect(await readRepoTarget(none.fs, DIR)).toBeUndefined();
    expect(await none.send()).toEqual({ kind: "no_remote" });
  });
});

describe("送る", () => {
  test("書き換えた話を送り、送ったあとは送っていない話が0になる。版の見出しは送った話", async () => {
    const { gh, fs, send } = await setup("https://github.com/sakka/toudai.git");
    await fs.promises.writeFile(`${DIR}/本文/第1話 手紙.txt`, utf8("一。書き足した\n"));
    expect(await send("モバイル版で書いた：第1話 手紙")).toEqual({ kind: "pushed", adopted: true });
    expect((await gh.files())["本文/第1話 手紙.txt"]).toBe("一。書き足した\n");
    const { commit } = await git.readCommit({ fs: gh.fs, dir: gh.dir, oid: gh.head });
    expect(commit.message.trim()).toBe("モバイル版で書いた：第1話 手紙");
    expect(await readWorkSync(fs, WORK, BASE)).toEqual({ unsent: [], otherCount: 0 });
    expect(await send()).toEqual({ kind: "nothing_to_push" });
  });

  test("向こうが先へ進んでいたら送らず、先に取ってくるよう出す。取ってきて取り込めば送れる", async () => {
    const { gh, fs, send, fetch, read } = await setup("https://github.com/sakka/toudai.git");
    // もう1台が第2話を書き換えて送った
    await fs.promises.writeFile(`${DIR}/本文/第1話 手紙.txt`, utf8("こちらで書いた\n"));
    const other = await gh.commitFiles({ "本文/第2話 灯.txt": "あちらで書いた\n" });
    expect(other).toBe(gh.head);
    const behind = await send();
    expect(behind).toEqual({ kind: "behind" });
    expect(outcomeText(behind)).toContain("［取ってくる］");
    expect(await fetch()).toEqual({ kind: "fetched", taken: 1, kept: 1 });
    expect(await read("本文/第2話 灯.txt")).toBe("あちらで書いた\n");
    expect(await read("本文/第1話 手紙.txt")).toBe("こちらで書いた\n");
    expect(await send()).toEqual({ kind: "pushed", adopted: true });
    expect(await gh.files()).toMatchObject({ "本文/第1話 手紙.txt": "こちらで書いた\n", "本文/第2話 灯.txt": "あちらで書いた\n" });
  });

  test("合言葉が切れていれば（401）サインインし直すよう出す", async () => {
    const { gh, fs, send } = await setup("https://github.com/sakka/toudai.git");
    gh.failAt.ref = 401;
    await fs.promises.writeFile(`${DIR}/本文/第1話 手紙.txt`, utf8("x\n"));
    const result = await send();
    expect(result).toEqual({ kind: "failed", reason: "sign_in_again" });
    expect(outcomeText(result)).toContain("サインインし直して");
  });
});

describe("取ってくる", () => {
  test("向こうに新しい版が無ければ「新しい変更はありません」", async () => {
    const { fetch } = await setup();
    expect(await fetch()).toEqual({ kind: "up_to_date" });
  });

  test("両方で同じ話を書き換えていたら、何も動かさずに競合の話を返す", async () => {
    const { gh, fs, fetch, read } = await setup("https://github.com/sakka/toudai.git");
    await fs.promises.writeFile(`${DIR}/本文/第1話 手紙.txt`, utf8("こちら\n"));
    await gh.commitFiles({ "本文/第1話 手紙.txt": "あちら\n" });
    const head = await git.resolveRef({ fs, dir: DIR, ref: "HEAD" });
    const result = await fetch();
    expect(result).toEqual({ kind: "conflicts", paths: ["本文/第1話 手紙.txt"] });
    expect(outcomeText(result)).toContain("1話");
    expect(await read("本文/第1話 手紙.txt")).toBe("こちら\n");
    expect(await git.resolveRef({ fs, dir: DIR, ref: "HEAD" })).toBe(head);
  });

  test("取得の失敗の分け方（401・404・届かない）", () => {
    expect(fetchFailure(new Errors.HttpError(401, "Unauthorized", ""))).toBe("sign_in_again");
    expect(fetchFailure(new Errors.HttpError(404, "Not Found", ""))).toBe("no_access");
    expect(fetchFailure(new TypeError("Failed to fetch"))).toBe("offline");
  });
});

test("版の見出しは送る話の名前（3話より多ければ ほかN話）。書き手は GitHub の返信しないアドレス", () => {
  expect(githubIdentity("sakka", 1234)).toEqual({ name: "sakka", email: "1234+sakka@users.noreply.github.com" });
  expect(githubIdentity("sakka")).toEqual({ name: "sakka", email: "sakka@users.noreply.github.com" });
  expect(pushMessage([])).toBe("モバイル版で書いた");
  expect(pushMessage(["灯台守_確認用/本文/第1話 手紙.txt"])).toBe("モバイル版で書いた：第1話 手紙");
  expect(pushMessage(["a/1.txt", "a/2.txt", "a/3.txt", "a/4.txt", "a/5.txt"])).toBe("モバイル版で書いた：1・2・3 ほか2話");
});
