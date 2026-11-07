import "../src/platform/bufferShim";
import git from "isomorphic-git";
import { describe, expect, test } from "vitest";
import { MemoryGitFsBackend, createGitFs } from "../src/platform/gitFs";
import { collectChanges, pushWork, type WorkPushInput } from "../src/platform/workPush";
import { FakeGitHub, author, text } from "./support/fakeGitHub";

/**
 * 手元の作品を GitHub の API で送る（引継ぎ書 11章）。偽の GitHub と手元のリポジトリは
 * 同じ中身・同じ署名で「はじめ」の版を作るので、同じ版の名前から始まる（取得のあとの状態）。
 */

const start = { "原稿/第1話.txt": "吾輩は猫である。\r\n", "原稿/第2話.txt": "名前はまだ無い。\n", "設定/characters.json": "{}\n" };

async function setup(msPerWrite = 1_000) {
  const gh = new FakeGitHub();
  const remote = await gh.init(start);
  const backend = new MemoryGitFsBackend(msPerWrite);
  const fs = createGitFs(backend);
  const dir = "/works/作品";
  await fs.promises.mkdir("/works");
  await fs.promises.mkdir(dir);
  await git.init({ fs, dir, defaultBranch: "main" });
  for (const [path, s] of Object.entries(start)) {
    const folder = path.split("/")[0];
    await fs.promises.mkdir(`${dir}/${folder}`).catch(() => undefined);
    await fs.promises.writeFile(`${dir}/${path}`, s);
    await git.add({ fs, dir, filepath: path });
  }
  const local = await git.commit({ fs, dir, message: "はじめ\n", author, committer: author });
  expect(local).toBe(remote.commit);

  /** 偽の取得：向こうの版の物を手元へ写す（木と中身は手元にもうある） */
  const adopt = async (commit: string) => {
    const { object } = await git.readObject({ fs: gh.fs, dir: gh.dir, oid: commit, format: "content" });
    await git.writeObject({ fs, dir, type: "commit", object: object as Uint8Array, format: "content" });
  };
  const input = (extra: Partial<WorkPushInput> = {}): WorkPushInput => ({
    fs,
    dir,
    owner: "nonahisa",
    repo: "作品",
    branch: "main",
    token: "tkn",
    message: "スマホで書いた",
    author: { name: "作者", email: "author@example.invalid" },
    adopt,
    fetcher: gh.fetch,
    apiBase: "https://api.test",
    ...extra,
  });
  return { gh, fs, dir, backend, remote, input };
}

describe("変わった話を集める", () => {
  test("書き換え・新しい話・消した話を拾い、変わっていない話は拾わない", async () => {
    const { fs, dir } = await setup();
    await fs.promises.writeFile(`${dir}/原稿/第1話.txt`, "吾輩は猫である。名前はまだ無い。\r\n");
    await fs.promises.writeFile(`${dir}/原稿/第3話.txt`, "どこで生れたか\n");
    await fs.promises.unlink(`${dir}/原稿/第2話.txt`);
    const changes = await collectChanges(fs, dir);
    expect(changes.map((c) => [c.path, "deleted" in c ? "消した" : "書いた"])).toEqual([
      ["原稿/第1話.txt", "書いた"],
      ["原稿/第2話.txt", "消した"],
      ["原稿/第3話.txt", "書いた"],
    ]);
  });

  test("同じ秒に同じ大きさで書き換えても、アプリが名指しすれば拾う", async () => {
    const { fs, dir } = await setup(0);
    await fs.promises.writeFile(`${dir}/原稿/第2話.txt`, "名前はもう有る。\n"); // 同じバイト数
    expect(await collectChanges(fs, dir)).toEqual([]);
    const named = await collectChanges(fs, dir, ["原稿/第2話.txt"]);
    expect(named.map((c) => c.path)).toEqual(["原稿/第2話.txt"]);
  });

  test("名指ししても、中身が同じなら拾わない", async () => {
    const { fs, dir } = await setup();
    await fs.promises.writeFile(`${dir}/原稿/第2話.txt`, start["原稿/第2話.txt"]);
    expect(await collectChanges(fs, dir, ["原稿/第2話.txt"])).toEqual([]);
  });
});

describe("送る", () => {
  test("送れたら、手元の枝が向こうの版になり、作業の木はそのまま・変わった話は0になる", async () => {
    const { gh, fs, dir, input } = await setup();
    await fs.promises.writeFile(`${dir}/原稿/第1話.txt`, "書き足した\r\n");
    await fs.promises.unlink(`${dir}/原稿/第2話.txt`);
    const result = await pushWork(input());
    expect(result).toMatchObject({ kind: "pushed", adopted: true });
    if (result.kind !== "pushed") return;
    expect(gh.head).toBe(result.commit);
    expect(await git.resolveRef({ fs, dir, ref: "HEAD" })).toBe(result.commit);
    expect(await git.resolveRef({ fs, dir, ref: "refs/remotes/origin/main" })).toBe(result.commit);
    expect(await collectChanges(fs, dir)).toEqual([]);
    expect(new TextDecoder().decode((await fs.promises.readFile(`${dir}/原稿/第1話.txt`)) as Uint8Array)).toBe("書き足した\r\n");
    expect(await gh.files()).toEqual({ "原稿/第1話.txt": "書き足した\r\n", "設定/characters.json": "{}\n" });
  });

  test("2回続けて送れる（2回目は1回目の版の上に積む）", async () => {
    const { gh, fs, dir, input } = await setup();
    await fs.promises.writeFile(`${dir}/原稿/第1話.txt`, "一回目\n");
    const first = await pushWork(input());
    await fs.promises.writeFile(`${dir}/原稿/第1話.txt`, "二回目の原稿\n");
    const second = await pushWork(input());
    expect(second).toMatchObject({ kind: "pushed", adopted: true });
    if (first.kind !== "pushed" || second.kind !== "pushed") return;
    const { commit } = await git.readCommit({ fs: gh.fs, dir: gh.dir, oid: second.commit });
    expect(commit.parent).toEqual([first.commit]);
    expect((await gh.files())["原稿/第1話.txt"]).toBe("二回目の原稿\n");
  });

  test("変わっていなければ何も送らない", async () => {
    const { gh, input } = await setup();
    expect(await pushWork(input())).toEqual({ kind: "nothing_to_push" });
    expect(gh.calls).toEqual([]);
  });

  test("向こうが先へ進んでいたら、手元の枝も作業の木も動かさない", async () => {
    const { gh, fs, dir, remote, input } = await setup();
    gh.head = await git.writeCommit({
      fs: gh.fs,
      dir: gh.dir,
      commit: { message: "パソコン\n", tree: remote.tree, parent: [remote.commit], author, committer: author },
    });
    await fs.promises.writeFile(`${dir}/原稿/第1話.txt`, "スマホ\n");
    expect(await pushWork(input())).toEqual({ kind: "behind", remoteHead: gh.head });
    expect(await git.resolveRef({ fs, dir, ref: "HEAD" })).toBe(remote.commit);
    expect((await collectChanges(fs, dir)).map((c) => c.path)).toEqual(["原稿/第1話.txt"]);
  });

  test("送れたが取り込めなかったら（取得が失敗）、手元の枝は前の版のまま adopted: false", async () => {
    const { fs, dir, remote, input } = await setup();
    await fs.promises.writeFile(`${dir}/原稿/第1話.txt`, "x\n");
    const result = await pushWork(
      input({
        adopt: async () => {
          throw new TypeError("Failed to fetch");
        },
      })
    );
    expect(result).toMatchObject({ kind: "pushed", adopted: false });
    expect(await git.resolveRef({ fs, dir, ref: "HEAD" })).toBe(remote.commit);
  });

  test("届いた中身が化けたら送らず、手元はそのまま", async () => {
    const { gh, fs, dir, remote, input } = await setup();
    gh.mangleBlob = (bytes) => text(new TextDecoder().decode(bytes).replace(/\n/g, "\r\n"));
    await fs.promises.writeFile(`${dir}/原稿/第2話.txt`, "直した\n");
    expect(await pushWork(input())).toMatchObject({ kind: "failed", error: { kind: "hash_mismatch" } });
    expect(gh.head).toBe(remote.commit);
    expect(await git.resolveRef({ fs, dir, ref: "HEAD" })).toBe(remote.commit);
  });
});
