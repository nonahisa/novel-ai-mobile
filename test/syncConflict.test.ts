import "../src/platform/bufferShim";
import iconv from "iconv-lite";
import git, { Errors } from "isomorphic-git";
import { describe, expect, test } from "vitest";
import { MemoryGitFsBackend, createGitFs } from "../src/platform/gitFs";
import {
  applyConflictChoice,
  integrateIncoming,
  planIncoming,
  readConflict,
  type IncomingPlan,
} from "../src/platform/syncConflict";
import { collectChanges, pushWork } from "../src/platform/workPush";
import { createAutoSave } from "../src/app/autoSave";
import { RECOVERY_DIRECTORY_NAME, readTextFile } from "../src/platform/textFile";
import { steadyGitFsOptions } from "./support/steadyGitFs";
import { FakeGitHub, author } from "./support/fakeGitHub";
import { GitFsFileStore } from "./support/gitFsFileStore";

/**
 * 同期の食い違いの扱い（`src/platform/syncConflict.ts`。設計書 6章）。
 *
 * 手元のリポジトリに「祖先」の版を作り、あちらの版は同じリポジトリに書いて
 * `refs/remotes/origin/main` に置く（取ってきたあとの状態）。こちらは作業の木を書き換えて作る。
 */

type Fs = ReturnType<typeof createGitFs>;
type Content = string | Uint8Array;

const utf8 = (s: string) => new TextEncoder().encode(s);
const sjis = (s: string) => new Uint8Array(iconv.encode(s, "shift_jis"));
const WORK = "works/作品_確認用";
const LEDGER = "設定/投稿状態.json";
function ledgerText(posts: unknown[], sites: unknown[] = [{ site: "kakuyomu", newEpisodeUrl: "https://kakuyomu.jp/my/works/1177354054/episodes/new" }, { site: "narou", newEpisodeUrl: "https://syosetu.com/usernovelmanage/ziwaiinput/ncode/123/" }]): string {
  return `${JSON.stringify({ schemaVersion: "1", sites, posts, rankings: [] }, null, 2)}\n`;
}
const DIR = `/${WORK}`;

const start: Record<string, Content> = {
  ".gitignore": ".novelai-recovery/\n",
  "本文/第1話.txt": "吾輩は猫である。\n名前はまだ無い。\n",
  "本文/第2話.txt": "どこで生れたか\n",
  "本文/第3話.txt": sjis("とんと見当がつかぬ。\r\n"),
  "設定/characters.json": "{}\n",
  [LEDGER]: ledgerText([{ episodePath: "本文/第1話.txt", site: "kakuyomu", postedAt: "2026-11-01T00:00:00.000Z" }]),
};

async function writeWork(fs: Fs, path: string, content: Content): Promise<void> {
  const parts = path.split("/");
  let folder = DIR;
  for (const part of parts.slice(0, -1)) {
    folder = `${folder}/${part}`;
    await fs.promises.mkdir(folder).catch(() => undefined);
  }
  await fs.promises.writeFile(`${DIR}/${path}`, typeof content === "string" ? utf8(content) : content);
}

async function readWork(fs: Fs, path: string): Promise<Uint8Array | undefined> {
  try {
    return new Uint8Array((await fs.promises.readFile(`${DIR}/${path}`)) as Uint8Array);
  } catch {
    return undefined;
  }
}

const textOf = (bytes: Uint8Array | undefined) => (bytes ? new TextDecoder().decode(bytes) : undefined);

async function setup(msPerWrite = 1_000) {
  const backend = new MemoryGitFsBackend(msPerWrite);
  const fs = createGitFs(backend, steadyGitFsOptions());
  const store = new GitFsFileStore(backend);
  await fs.promises.mkdir("/works");
  await fs.promises.mkdir(DIR);
  await git.init({ fs, dir: DIR, defaultBranch: "main" });
  for (const [path, content] of Object.entries(start)) {
    await writeWork(fs, path, content);
    await git.add({ fs, dir: DIR, filepath: path });
  }
  const base = await git.commit({ fs, dir: DIR, message: "はじめ\n", author, committer: author });

  /** あちらの版を作って、取ってきたことにする（null は消した） */
  const theirs = async (changes: Record<string, Content | null>, parent = base): Promise<string> => {
    const flat = new Map<string, string>();
    const walk = async (tree: string, prefix: string) => {
      for (const entry of (await git.readTree({ fs, dir: DIR, oid: tree })).tree) {
        if (entry.type === "tree") await walk(entry.oid, `${prefix}${entry.path}/`);
        else flat.set(prefix + entry.path, entry.oid);
      }
    };
    await walk((await git.readCommit({ fs, dir: DIR, oid: base })).commit.tree, "");
    for (const [path, content] of Object.entries(changes)) {
      if (content === null) flat.delete(path);
      else flat.set(path, await git.writeBlob({ fs, dir: DIR, blob: typeof content === "string" ? utf8(content) : content }));
    }
    const writeTree = async (prefix: string): Promise<string> => {
      const names = new Map<string, string | undefined>();
      for (const [path, oid] of flat) {
        if (!path.startsWith(prefix)) continue;
        const rest = path.slice(prefix.length);
        const slash = rest.indexOf("/");
        names.set(slash < 0 ? rest : rest.slice(0, slash), slash < 0 ? oid : undefined);
      }
      const tree = [];
      for (const [name, oid] of names) {
        tree.push(
          oid
            ? { mode: "100644", path: name, oid, type: "blob" as const }
            : { mode: "040000", path: name, oid: await writeTree(`${prefix}${name}/`), type: "tree" as const }
        );
      }
      return git.writeTree({ fs, dir: DIR, tree });
    };
    const commit = await git.writeCommit({
      fs,
      dir: DIR,
      commit: { message: "パソコンで書いた\n", tree: await writeTree(""), parent: [parent], author, committer: author },
    });
    await git.writeRef({ fs, dir: DIR, ref: "refs/remotes/origin/main", value: commit, force: true });
    return commit;
  };

  const io = { fs, dir: DIR, store, storeDir: WORK };
  return { backend, fs, store, base, theirs, io };
}

const kinds = (plan: IncomingPlan) => Object.fromEntries(plan.entries.map((entry) => [entry.path, entry.kind]));

describe("話ごとに分ける", () => {
  test("こちらだけ・あちらだけ・同じ・競合（消した場合も）を分ける", async () => {
    const { fs, theirs, io } = await setup();
    await theirs({
      "本文/第1話.txt": "吾輩は猫である。\n名前はもう有る。\n",
      "本文/第2話.txt": "生れはパソコン\n",
      "本文/第4話.txt": "新しい話\n",
      "本文/第3話.txt": null,
    });
    await writeWork(fs, "本文/第2話.txt", "生れはパソコン\n"); // 同じに変えた
    await writeWork(fs, "本文/第3話.txt", sjis("とんと見当がつかぬ。書き足した。\r\n")); // あちらは消した
    await writeWork(fs, "設定/characters.json", '{"a":1}\n'); // こちらだけ
    const plan = await planIncoming(io);
    expect(kinds(plan)).toEqual({
      "本文/第1話.txt": "theirs_only",
      "本文/第2話.txt": "same",
      "本文/第3話.txt": "conflict",
      "本文/第4話.txt": "theirs_only",
      "設定/characters.json": "ours_only",
    });
    expect(plan.undecided.map((entry) => entry.path)).toEqual(["本文/第3話.txt"]);
    expect(plan.conflicts[0]).toMatchObject({ theirs: null });
  });

  test("こちらで話の名前を変え（サブタイトル案。2026-11-21）、あちらが古い名前の話を直したら、競合として見せる（あちらの直しを黙って落とさない）", async () => {
    const { fs, theirs, io } = await setup();
    await theirs({ "本文/第2話.txt": "どこで生れたか、パソコンで書き足した\n" });
    await writeWork(fs, "本文/第2話_生れ.txt", "どこで生れたか\n");
    await fs.promises.unlink(`${DIR}/本文/第2話.txt`);
    const plan = await planIncoming(io);
    expect(kinds(plan)).toMatchObject({ "本文/第2話.txt": "conflict", "本文/第2話_生れ.txt": "ours_only" });
    expect(plan.undecided.map((entry) => entry.path)).toEqual(["本文/第2話.txt"]);
  });

  test("あちらの版が手元と同じなら、何も無い", async () => {
    const { base, io } = await setup();
    expect(await planIncoming({ ...io, theirs: base })).toMatchObject({ entries: [], conflicts: [] });
  });

  test("同じ秒に同じ大きさで書き換えた話も、中身を読んで競合と見分ける（黙って上書きしない）", async () => {
    const { fs, theirs, io } = await setup(0);
    await theirs({ "本文/第2話.txt": "生れはパソコン\n" });
    await writeWork(fs, "本文/第2話.txt", "どこで死んだか\n"); // 同じバイト数
    expect(await git.statusMatrix({ fs, dir: DIR, filepaths: ["本文/第2話.txt"] })).toEqual([["本文/第2話.txt", 1, 1, 1]]);
    const plan = await planIncoming(io);
    expect(kinds(plan)).toEqual({ "本文/第2話.txt": "conflict" });
    expect(await integrateIncoming(io)).toMatchObject({ kind: "conflicts" });
    expect(textOf(await readWork(fs, "本文/第2話.txt"))).toBe("どこで死んだか\n");
  });
});

describe("取り込む", () => {
  test("こちらに変更が無ければ早送り：作業の木と HEAD があちらの版になり、送っていない話は0", async () => {
    const { fs, theirs, io } = await setup();
    const remote = await theirs({ "本文/第1話.txt": "直した\n", "本文/第3話.txt": null, "本文/章2/第5話.txt": "五\n" });
    const result = await integrateIncoming(io);
    expect(result).toMatchObject({ kind: "integrated", head: remote, fastForward: true, kept: [] });
    expect(await git.resolveRef({ fs, dir: DIR, ref: "HEAD" })).toBe(remote);
    expect(textOf(await readWork(fs, "本文/第1話.txt"))).toBe("直した\n");
    expect(await readWork(fs, "本文/第3話.txt")).toBeUndefined();
    expect(textOf(await readWork(fs, "本文/章2/第5話.txt"))).toBe("五\n");
    expect(await collectChanges(fs, DIR)).toEqual([]);
    expect(await integrateIncoming(io)).toEqual({ kind: "up_to_date" });
  });

  test("こちらだけ変えた話は残したまま、あちらだけ変えた話を取り込み、続けて送れる", async () => {
    const { fs, base, theirs, io } = await setup();
    const remote = await theirs({ "本文/第1話.txt": "パソコンで直した\n" });
    await writeWork(fs, "本文/第2話.txt", "スマホで書き足した\n");
    const result = await integrateIncoming(io);
    expect(result).toMatchObject({ kind: "integrated", fastForward: false, taken: ["本文/第1話.txt"], kept: ["本文/第2話.txt"] });
    expect((await collectChanges(fs, DIR)).map((change) => change.path)).toEqual(["本文/第2話.txt"]);

    // 偽の GitHub にも同じ2つの版を写して、送る
    const gh = new FakeGitHub();
    await gh.fs.promises.mkdir(gh.dir);
    await git.init({ fs: gh.fs, dir: gh.dir, defaultBranch: "main" });
    await copyObjects(fs, gh.fs, gh.dir, remote);
    gh.head = remote;
    expect(base).not.toBe(remote);
    const pushed = await pushWork({
      fs,
      dir: DIR,
      owner: "nonahisa",
      repo: "作品_確認用",
      branch: "main",
      token: "tkn",
      message: "スマホで書いた",
      author: { name: "作者", email: "author@example.invalid" },
      adopt: async (commit) => copyObjects(gh.fs, fs, DIR, commit),
      fetcher: gh.fetch,
      apiBase: "https://api.test",
    });
    expect(pushed).toMatchObject({ kind: "pushed", adopted: true });
    const files = await gh.files();
    expect(files["本文/第1話.txt"]).toBe("パソコンで直した\n");
    expect(files["本文/第2話.txt"]).toBe("スマホで書き足した\n");
  });

  test("競合が残っているあいだは何も動かさず、送ると「向こうが先」のまま", async () => {
    const { fs, base, theirs, io } = await setup();
    const remote = await theirs({ "本文/第1話.txt": "パソコン\n", "本文/第2話.txt": "あちらだけ\n" });
    await writeWork(fs, "本文/第1話.txt", "スマホ\n");
    expect(await integrateIncoming(io)).toMatchObject({ kind: "conflicts" });
    expect(await git.resolveRef({ fs, dir: DIR, ref: "HEAD" })).toBe(base);
    expect(textOf(await readWork(fs, "本文/第1話.txt"))).toBe("スマホ\n");
    expect(textOf(await readWork(fs, "本文/第2話.txt"))).toBe("どこで生れたか\n");

    const gh = new FakeGitHub();
    await gh.fs.promises.mkdir(gh.dir);
    await git.init({ fs: gh.fs, dir: gh.dir, defaultBranch: "main" });
    await copyObjects(fs, gh.fs, gh.dir, remote);
    gh.head = remote;
    const pushed = await pushWork({
      fs,
      dir: DIR,
      owner: "nonahisa",
      repo: "作品_確認用",
      branch: "main",
      token: "tkn",
      message: "スマホ",
      author: { name: "作者", email: "author@example.invalid" },
      fetcher: gh.fetch,
      apiBase: "https://api.test",
    });
    expect(pushed).toEqual({ kind: "behind", remoteHead: remote });
  });
});

describe("競合を選ぶ", () => {
  async function conflicted() {
    const ctx = await setup();
    await ctx.theirs({
      "本文/第1話.txt": "吾輩は猫である。\n名前はパソコンで付けた。\n",
      "本文/第3話.txt": sjis("とんと見当がつかぬ。パソコン。\r\n"),
      "設定/characters.json": '{"b":2}\n',
    });
    await writeWork(ctx.fs, "本文/第1話.txt", "吾輩は猫である。\n名前はスマホで付けた。\n");
    await writeWork(ctx.fs, "本文/第3話.txt", sjis("とんと見当がつかぬ。スマホ。\r\n"));
    await writeWork(ctx.fs, "設定/characters.json", '{"a":1}\n');
    return ctx;
  }

  test("選ぶための材料に、両方と祖先の中身が入る。JSON には［両方残す］を出さない", async () => {
    const { io } = await conflicted();
    const material = await readConflict({ ...io, path: "本文/第3話.txt" });
    expect(material).toMatchObject({
      ours: { exists: true, text: "とんと見当がつかぬ。スマホ。\n", content: { encoding: "shift_jis", eol: "\r\n" } },
      theirs: { exists: true, text: "とんと見当がつかぬ。パソコン。\n" },
      base: { exists: true, text: "とんと見当がつかぬ。\n" },
      choices: ["ours", "theirs", "both"],
    });
    expect((await readConflict({ ...io, path: "設定/characters.json" }))?.choices).toEqual(["ours", "theirs"]);
    expect(await readConflict({ ...io, path: "本文/第2話.txt" })).toBeUndefined();
  });

  test("［あちら］は原稿をあちらの文にする（Shift_JIS・CRLF のまま、バイトまで同じ）", async () => {
    const { fs, io } = await conflicted();
    const material = (await readConflict({ ...io, path: "本文/第3話.txt" }))!;
    expect(await applyConflictChoice({ ...io, material, choice: "theirs" })).toEqual({ ok: true, choice: "theirs", exact: true });
    expect([...(await readWork(fs, "本文/第3話.txt"))!]).toEqual([...sjis("とんと見当がつかぬ。パソコン。\r\n")]);
    const plan = await planIncoming(io);
    expect(kinds(plan)["本文/第3話.txt"]).toBe("same");
  });

  test("［こちら］は原稿を変えずに控え、全部選んだら取り込む。こちらの文は送っていない話になる", async () => {
    const { fs, io } = await conflicted();
    for (const path of ["本文/第1話.txt", "本文/第3話.txt", "設定/characters.json"]) {
      const material = (await readConflict({ ...io, path }))!;
      expect(await applyConflictChoice({ ...io, material, choice: "ours" })).toEqual({ ok: true, choice: "ours" });
    }
    expect(textOf(await readWork(fs, "本文/第1話.txt"))).toBe("吾輩は猫である。\n名前はスマホで付けた。\n");
    expect((await planIncoming(io)).undecided).toEqual([]);
    const result = await integrateIncoming(io);
    expect(result).toMatchObject({ kind: "integrated", fastForward: false });
    expect((await collectChanges(fs, DIR)).map((change) => change.path)).toEqual([
      "本文/第1話.txt",
      "本文/第3話.txt",
      "設定/characters.json",
    ]);
    // 控えは片付く
    await expect(fs.promises.stat(`${DIR}/.git/novelai-conflict-choices.json`)).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("［両方残す］はあちらの文を本体と同じ名前の別ファイルへ、こちらと同じ文字コード・改行で残す", async () => {
    const { fs, store, io } = await conflicted();
    const material = (await readConflict({ ...io, path: "本文/第3話.txt" }))!;
    const now = new Date(2026, 10, 16, 9, 5);
    // 同じ名前があれば -2 を付ける（本体の sideFileName）
    await store.writeFile(`${WORK}/本文/第3話.conflict-2026-11-16-0905.txt`, utf8("前の写し\n"), { mode: "create" });
    const result = await applyConflictChoice({ ...io, material, choice: "both", now });
    expect(result).toEqual({ ok: true, choice: "both", sidePath: "本文/第3話.conflict-2026-11-16-0905-2.txt" });
    expect([...(await readWork(fs, "本文/第3話.conflict-2026-11-16-0905-2.txt"))!]).toEqual([...sjis("とんと見当がつかぬ。パソコン。\r\n")]);
    expect([...(await readWork(fs, "本文/第3話.txt"))!]).toEqual([...sjis("とんと見当がつかぬ。スマホ。\r\n")]);
    expect(textOf(await readWork(fs, "本文/第3話.conflict-2026-11-16-0905.txt"))).toBe("前の写し\n");
    expect((await planIncoming(io)).conflicts.find((entry) => entry.path === "本文/第3話.txt")?.decision).toBe("both");
  });

  test("［両方残す］を出していない話（JSON）では選べない", async () => {
    const { io } = await conflicted();
    const material = (await readConflict({ ...io, path: "設定/characters.json" }))!;
    expect(await applyConflictChoice({ ...io, material, choice: "both" })).toEqual({ ok: false, reason: "not_offered" });
  });

  test("材料を読んだあとにこちらで書き換えたら、選んでも書かない。選んだあとに書き換えたら、選び直しになる", async () => {
    const { fs, io } = await conflicted();
    const material = (await readConflict({ ...io, path: "本文/第1話.txt" }))!;
    await writeWork(fs, "本文/第1話.txt", "さらに書いた\n");
    expect(await applyConflictChoice({ ...io, material, choice: "theirs" })).toMatchObject({ ok: false, reason: "modified_externally" });
    expect(textOf(await readWork(fs, "本文/第1話.txt"))).toBe("さらに書いた\n");

    const again = (await readConflict({ ...io, path: "本文/第1話.txt" }))!;
    expect(await applyConflictChoice({ ...io, material: again, choice: "ours" })).toMatchObject({ ok: true });
    await writeWork(fs, "本文/第1話.txt", "選んだあとに書いた\n");
    expect((await planIncoming(io)).undecided.map((entry) => entry.path)).toContain("本文/第1話.txt");
  });

  test("あちらの版が進んだら、前の材料では選べない", async () => {
    const { io, theirs } = await conflicted();
    const material = (await readConflict({ ...io, path: "本文/第1話.txt" }))!;
    await theirs({ "本文/第1話.txt": "もう一度パソコンで\n" });
    expect(await applyConflictChoice({ ...io, material, choice: "theirs" })).toEqual({ ok: false, reason: "stale" });
  });

  test("［あちら］と［両方残す］で全部選び、取り込むと、送っていない話は別ファイルとこちらを選んだ話だけ", async () => {
    const { fs, io } = await conflicted();
    const now = new Date(2026, 10, 16, 21, 30);
    const pick = async (path: string, choice: "ours" | "theirs" | "both") =>
      applyConflictChoice({ ...io, material: (await readConflict({ ...io, path }))!, choice, now });
    expect(await pick("本文/第1話.txt", "both")).toMatchObject({ ok: true, sidePath: "本文/第1話.conflict-2026-11-16-2130.txt" });
    expect(await pick("本文/第3話.txt", "theirs")).toMatchObject({ ok: true, exact: true });
    expect(await pick("設定/characters.json", "theirs")).toMatchObject({ ok: true, exact: true });
    expect(await integrateIncoming(io)).toMatchObject({ kind: "integrated" });
    // 書き戻しの退避（.novelai-recovery）は .gitignore で外れる
    expect((await collectChanges(fs, DIR)).map((change) => change.path)).toEqual([
      "本文/第1話.conflict-2026-11-16-2130.txt",
      "本文/第1話.txt",
    ]);
  });

  test("［あちら］で文字コード・改行がこちらと違っても（こちらの形で書く）、選び済みになり、取り込める", async () => {
    const { fs, theirs, io } = await setup();
    // こちらは Shift_JIS・CRLF、あちら（パソコン）は UTF-8・LF で書き換えた
    await theirs({ "本文/第3話.txt": "とんと見当がつかぬ。パソコン。\n" });
    await writeWork(fs, "本文/第3話.txt", sjis("とんと見当がつかぬ。スマホ。\r\n"));
    const material = (await readConflict({ ...io, path: "本文/第3話.txt" }))!;
    expect(await applyConflictChoice({ ...io, material, choice: "theirs" })).toMatchObject({ ok: true, exact: false });
    const plan = await planIncoming(io);
    expect(plan.undecided).toEqual([]);
    expect(plan.conflicts.map((entry) => entry.decision)).toEqual(["theirs"]);
    expect(await integrateIncoming(io)).toMatchObject({ kind: "integrated", kept: ["本文/第3話.txt"] });
    expect(new Uint8Array((await readWork(fs, "本文/第3話.txt"))!)).toEqual(sjis("とんと見当がつかぬ。パソコン。\r\n"));
  });

  test("こちらが消してあちらが変えた話：［あちら］で作り直す。あちらが消した話：［あちら］で消す", async () => {
    const ctx = await setup();
    await ctx.theirs({ "本文/第1話.txt": "あちらで直した\n", "本文/第2話.txt": null });
    await ctx.fs.promises.unlink(`${DIR}/本文/第1話.txt`);
    await writeWork(ctx.fs, "本文/第2話.txt", "こちらで直した\n");
    const first = (await readConflict({ ...ctx.io, path: "本文/第1話.txt" }))!;
    const second = (await readConflict({ ...ctx.io, path: "本文/第2話.txt" }))!;
    expect(first.choices).toEqual(["ours", "theirs"]);
    expect(second.choices).toEqual(["ours", "theirs"]);
    expect(await applyConflictChoice({ ...ctx.io, material: first, choice: "theirs" })).toMatchObject({ ok: true, exact: true });
    expect(await applyConflictChoice({ ...ctx.io, material: second, choice: "theirs" })).toMatchObject({ ok: true });
    expect(textOf(await readWork(ctx.fs, "本文/第1話.txt"))).toBe("あちらで直した\n");
    expect(await readWork(ctx.fs, "本文/第2話.txt")).toBeUndefined();
    expect(await integrateIncoming(ctx.io)).toMatchObject({ kind: "integrated", fastForward: true });
    expect(await collectChanges(ctx.fs, DIR)).toEqual([]);
  });

  test("あちらが消した話を［あちら］で消すとき、こちらの送っていない直しを退避に残す（git にも無いので、退避が無いと二度と戻らない）", async () => {
    const ctx = await setup();
    await ctx.theirs({ "本文/第2話.txt": null });
    await writeWork(ctx.fs, "本文/第2話.txt", "こちらで直した。まだ送っていない\n");
    const material = (await readConflict({ ...ctx.io, path: "本文/第2話.txt" }))!;
    const result = await applyConflictChoice({ ...ctx.io, material, choice: "theirs" });
    expect(result).toMatchObject({ ok: true, choice: "theirs" });
    expect(await readWork(ctx.fs, "本文/第2話.txt")).toBeUndefined();
    const recovery = `${DIR}/本文/${RECOVERY_DIRECTORY_NAME}`;
    const names = (await ctx.fs.promises.readdir(recovery)) as string[];
    expect(names).toHaveLength(1);
    expect(textOf(new Uint8Array((await ctx.fs.promises.readFile(`${recovery}/${names[0]}`)) as Uint8Array))).toBe("こちらで直した。まだ送っていない\n");
    expect(result).toMatchObject({ recoveryPath: `${WORK}/本文/${RECOVERY_DIRECTORY_NAME}/${names[0]}` });
  });

  test("退避を作れなければ、消さずに止める", async () => {
    const ctx = await setup();
    await ctx.theirs({ "本文/第2話.txt": null });
    await writeWork(ctx.fs, "本文/第2話.txt", "こちらで直した\n");
    const material = (await readConflict({ ...ctx.io, path: "本文/第2話.txt" }))!;
    // 退避のフォルダーの名前の所にファイルがあって、フォルダーを作れない
    await writeWork(ctx.fs, `本文/${RECOVERY_DIRECTORY_NAME}`, "じゃま\n");
    expect(await applyConflictChoice({ ...ctx.io, material, choice: "theirs" })).toMatchObject({ ok: false, reason: "path_conflict" });
    expect(textOf(await readWork(ctx.fs, "本文/第2話.txt"))).toBe("こちらで直した\n");
  });
});

/**
 * 【確かめた】isomorphic-git の `merge` で「競合の印を書く合流」ができるか（設計書 6章の【確かめる】）。
 * 使わないことにした理由を、実際の動きで残す（引継ぎ書 44章）。
 */
describe("isomorphic-git の merge を確かめる", () => {
  async function branches() {
    const ctx = await setup();
    const remote = await ctx.theirs({ "本文/第1話.txt": "吾輩は猫である。\n名前はパソコン。\n" });
    await writeWork(ctx.fs, "本文/第1話.txt", "吾輩は猫である。\n名前はスマホ。\n");
    return { ...ctx, remote };
  }

  test("記録していない書きかけは合流の相手にならない（記録した版どうししか合わせない）", async () => {
    const { fs, remote } = await branches();
    // 書きかけのまま合わせると、こちらの側は HEAD（祖先）なので早送りになり、作業の木はそのまま
    const result = await git.merge({ fs, dir: DIR, theirs: remote, author, abortOnConflict: false });
    expect(result).toMatchObject({ fastForward: true });
    expect(textOf(await readWork(fs, "本文/第1話.txt"))).toBe("吾輩は猫である。\n名前はスマホ。\n");
  });

  test("記録してから合わせると、abortOnConflict: false で作業の木の原稿に競合の印を書く", async () => {
    const { fs, remote } = await branches();
    await git.add({ fs, dir: DIR, filepath: "本文/第1話.txt" });
    await git.commit({ fs, dir: DIR, message: "スマホ\n", author, committer: author });
    const error = await git.merge({ fs, dir: DIR, theirs: remote, author, abortOnConflict: false }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Errors.MergeConflictError);
    const merged = textOf(await readWork(fs, "本文/第1話.txt"))!;
    expect(merged).toMatch(/^<{7} /m);
    expect(merged).toMatch(/^>{7} /m);
    expect(merged).toContain("名前はスマホ。");
    expect(merged).toContain("名前はパソコン。");
  });

  test("【限界】Shift_JIS の原稿に印を書くと、本文を UTF-8 として読み直すので字が壊れる", async () => {
    const ctx = await setup();
    const remote = await ctx.theirs({ "本文/第3話.txt": sjis("とんと見当がつかぬ。パソコン。\r\n") });
    await writeWork(ctx.fs, "本文/第3話.txt", sjis("とんと見当がつかぬ。スマホ。\r\n"));
    await git.add({ fs: ctx.fs, dir: DIR, filepath: "本文/第3話.txt" });
    await git.commit({ fs: ctx.fs, dir: DIR, message: "スマホ\n", author, committer: author });
    await git.merge({ fs: ctx.fs, dir: DIR, theirs: remote, author, abortOnConflict: false }).catch(() => undefined);
    const bytes = (await readWork(ctx.fs, "本文/第3話.txt"))!;
    const merged = iconv.decode(Buffer.from(bytes), "shift_jis");
    expect(merged).toMatch(/^<{7} /m);
    // Shift_JIS として読んでも、元の字が出てこない（作者の原稿が壊れる）
    expect(merged).not.toContain("スマホ");
    expect(merged).not.toContain("パソコン");
    expect(new TextDecoder().decode(bytes)).toContain("�");
  });

  test("祖先までの途中の版が手元に無い（浅い取得）と、合流の元を探せずに止まる", async () => {
    const { fs, theirs } = await setup();
    await git.add({ fs, dir: DIR, filepath: "本文/第2話.txt" });
    await writeWork(fs, "本文/第2話.txt", "スマホ\n");
    await git.add({ fs, dir: DIR, filepath: "本文/第2話.txt" });
    await git.commit({ fs, dir: DIR, message: "スマホ\n", author, committer: author });
    // あちらの版の親は手元に無い版（浅い取得で、途中の版を取っていない）
    const remote = await theirs({ "本文/第1話.txt": "パソコン\n" }, "0123456789abcdef0123456789abcdef01234567");
    const error = await git.merge({ fs, dir: DIR, theirs: remote, author, abortOnConflict: false }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
  });
});

/** 版と、その木と中身を、別のリポジトリへ写す（取得の代わり） */
async function copyObjects(from: Fs, to: Fs, toDir: string, commit: string): Promise<void> {
  const fromDir = from === to ? toDir : await dirOf(from);
  const seen = new Set<string>();
  const copy = async (oid: string): Promise<void> => {
    if (seen.has(oid)) return;
    seen.add(oid);
    const object = await git.readObject({ fs: from, dir: fromDir, oid, format: "content" });
    await git.writeObject({ fs: to, dir: toDir, type: object.type as "blob" | "tree" | "commit", object: object.object as Uint8Array, format: "content" });
    if (object.type === "commit") {
      const { commit: body } = await git.readCommit({ fs: from, dir: fromDir, oid });
      await copy(body.tree);
      for (const parent of body.parent) {
        try {
          await copy(parent);
        } catch {
          // 向こうに無い親は写さない
        }
      }
    } else if (object.type === "tree") {
      for (const entry of (await git.readTree({ fs: from, dir: fromDir, oid })).tree) await copy(entry.oid);
    }
  };
  await copy(commit);
}

/** 写す元のリポジトリの場所（偽の GitHub は `/remote`、手元は作品フォルダー） */
async function dirOf(fs: Fs): Promise<string> {
  try {
    await fs.promises.stat("/remote/.git");
    return "/remote";
  } catch {
    return DIR;
  }
}

describe("開いている話は、取り込む前に保存を済ませる（2026-11-16 作者の答え A）", () => {
  const open = async (store: GitFsFileStore, path: string) => {
    const story = `${WORK}/${path}`;
    return createAutoSave({ store, path: story, opened: await readTextFile(store, story) });
  };

  test("開いている話の書きかけを先に保存し、こちらの変更として残したまま取り込む", async () => {
    const { fs, store, theirs, io } = await setup();
    await theirs({ "本文/第1話.txt": "吾輩は猫である。\n名前はもう有る。\n" });
    const second = await open(store, "本文/第2話.txt");
    second.edit("どこで生れたか、スマホで書き足した\n");
    const result = await integrateIncoming({ ...io, openStories: [second] });
    expect(result).toMatchObject({ kind: "integrated", taken: ["本文/第1話.txt"], kept: ["本文/第2話.txt"], reopen: [] });
    expect(second.status()).toBe("保存済み");
    expect(textOf(await readWork(fs, "本文/第2話.txt"))).toBe("どこで生れたか、スマホで書き足した\n");
    expect(textOf(await readWork(fs, "本文/第1話.txt"))).toBe("吾輩は猫である。\n名前はもう有る。\n");
  });

  test("取り込みで書き換えた開いている話は reopen に返す（読み直して係を作り直す）", async () => {
    const { store, theirs, io } = await setup();
    await theirs({ "本文/第1話.txt": "吾輩は猫である。\n名前はもう有る。\n" });
    const first = await open(store, "本文/第1話.txt");
    const result = await integrateIncoming({ ...io, openStories: [first] });
    expect(result).toMatchObject({ kind: "integrated", reopen: [`${WORK}/本文/第1話.txt`] });
  });

  test("開いている話で書いた字と、あちらの変更がぶつかれば競合になる（書きかけは保存済み）", async () => {
    const { fs, store, theirs, io } = await setup();
    await theirs({ "本文/第1話.txt": "吾輩は猫である。\n名前はもう有る。\n" });
    const first = await open(store, "本文/第1話.txt");
    first.edit("吾輩は猫である。\n名前はスマホで付けた。\n");
    const result = await integrateIncoming({ ...io, openStories: [first] });
    expect(result).toMatchObject({ kind: "conflicts" });
    expect(textOf(await readWork(fs, "本文/第1話.txt"))).toBe("吾輩は猫である。\n名前はスマホで付けた。\n");
  });

  test("開いている話を保存できなければ、何も動かさずに止める", async () => {
    const { fs, store, theirs, io, base } = await setup();
    await theirs({ "本文/第1話.txt": "吾輩は猫である。\n名前はもう有る。\n" });
    const third = await open(store, "本文/第3話.txt");
    third.edit("とんと見当がつかぬ。🐈\n"); // Shift_JIS で書けない字
    const result = await integrateIncoming({ ...io, openStories: [third] });
    expect(result).toEqual({ kind: "open_unsaved", path: `${WORK}/本文/第3話.txt`, status: "保存待ち" });
    expect(await git.resolveRef({ fs, dir: DIR, ref: "HEAD" })).toBe(base);
    expect(textOf(await readWork(fs, "本文/第1話.txt"))).toBe("吾輩は猫である。\n名前はまだ無い。\n");
  });
});

describe("投稿の台帳がぶつかったら、両方の印を残して合わせる（2026-11-28 作者の答え）", () => {
  const p1 = { episodePath: "本文/第1話.txt", site: "kakuyomu", postedAt: "2026-11-01T00:00:00.000Z" };
  const mine = { episodePath: "本文/第2話.txt", site: "kakuyomu", postedAt: "2026-11-28T00:00:00.000Z" };
  const pc = { episodePath: "本文/第2話.txt", site: "narou", postedAt: "2026-11-27T00:00:00.000Z" };

  test("こちらが印を足し、あちらも印を足したら、選ばずに取り込み、こちらの印を足した台帳が送っていない変更として残る", async () => {
    const { fs, theirs, io } = await setup();
    const remote = await theirs({ [LEDGER]: ledgerText([p1, pc]), "本文/第1話.txt": "吾輩は猫である。\n名前はもう有る。\n" });
    await writeWork(fs, LEDGER, ledgerText([p1, mine]));
    const result = await integrateIncoming(io);
    expect(result).toMatchObject({ kind: "integrated", taken: ["本文/第1話.txt"], kept: [LEDGER] });
    expect(await git.resolveRef({ fs, dir: DIR, ref: "HEAD" })).toBe(remote);
    expect(JSON.parse(textOf(await readWork(fs, LEDGER))!).posts).toEqual([p1, pc, mine]);
    // 送ると、合わせた台帳があちらへ届く
    expect((await collectChanges(fs, DIR, [])).map((change) => change.path)).toEqual([LEDGER]);
  });

  test("話の競合が残っているあいだは、台帳は「印を合わせる」と決めた扱いで一覧に出すだけで、作業の木は動かさない。話を選んで取り込むと合わせる", async () => {
    const { fs, store, theirs, io, base } = await setup();
    await theirs({ [LEDGER]: ledgerText([p1, pc]), "本文/第2話.txt": "パソコンで直した"+"\n" });
    const ours = ledgerText([p1, mine]);
    await writeWork(fs, LEDGER, ours);
    await writeWork(fs, "本文/第2話.txt", "スマホで直した"+"\n");
    const plan = await planIncoming(io);
    expect(plan.conflicts.map((entry) => [entry.path, entry.decision])).toEqual([
      ["本文/第2話.txt", undefined],
      [LEDGER, "merge"],
    ]);
    expect(plan.undecided.map((entry) => entry.path)).toEqual(["本文/第2話.txt"]);
    expect(await integrateIncoming(io)).toMatchObject({ kind: "conflicts" });
    expect(textOf(await readWork(fs, LEDGER))).toBe(ours);
    expect(await git.resolveRef({ fs, dir: DIR, ref: "HEAD" })).toBe(base);
    // 話を［こちら］で選ぶと取り込み、そのとき台帳を合わせる
    const material = (await readConflict({ ...io, path: "本文/第2話.txt" }))!;
    expect((await applyConflictChoice({ ...io, material, choice: "ours" })).ok).toBe(true);
    expect(await integrateIncoming(io)).toMatchObject({ kind: "integrated" });
    expect(JSON.parse(textOf(await readWork(fs, LEDGER))!).posts).toEqual([p1, pc, mine]);
    expect(textOf(await readWork(fs, "本文/第2話.txt"))).toBe("スマホで直した"+"\n");
    void store;
  });

  test("台帳を自分で［あちら］と選んだら、そちらが勝つ（合わせない）", async () => {
    const { fs, theirs, io } = await setup();
    await theirs({ [LEDGER]: ledgerText([p1, pc]) });
    await writeWork(fs, LEDGER, ledgerText([p1, mine]));
    const material = (await readConflict({ ...io, path: LEDGER }))!;
    expect((await applyConflictChoice({ ...io, material, choice: "theirs" })).ok).toBe(true);
    expect(await integrateIncoming(io)).toMatchObject({ kind: "integrated" });
    expect(JSON.parse(textOf(await readWork(fs, LEDGER))!).posts).toEqual([p1, pc]);
  });

  test("こちらが印のほかも変えていたら合わせず、いつもどおり選ぶまで何も動かさない", async () => {
    const { fs, theirs, io, base } = await setup();
    await theirs({ [LEDGER]: ledgerText([p1, pc]) });
    const ours = ledgerText([p1, mine], [{ site: "kakuyomu", newEpisodeUrl: "https://kakuyomu.jp/my/works/1177354054/episodes/new" }]);
    await writeWork(fs, LEDGER, ours);
    const result = await integrateIncoming(io);
    expect(result).toMatchObject({ kind: "conflicts" });
    expect(await git.resolveRef({ fs, dir: DIR, ref: "HEAD" })).toBe(base);
    expect(textOf(await readWork(fs, LEDGER))).toBe(ours);
  });
});
