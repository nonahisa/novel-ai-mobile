import "../src/platform/bufferShim";
import git from "isomorphic-git";
import { describe, expect, test } from "vitest";
import {
  isSafeRepoPath,
  nextAction,
  pushViaGitHubApi,
  type FileChange,
  type PushInput,
} from "../src/platform/githubCommitApi";
import { FakeGitHub, author, memoryFs as fs, text } from "./support/fakeGitHub";

/**
 * GitHub の API で版を作って送る（原稿を持ち帰る道 A）。
 *
 * 偽の GitHub は中に isomorphic-git のリポジトリを持ち、中身・木・版を本物の git の名前（SHA-1）で作る。
 * だから「GitHub で組んだ木」と「手元の git で数えた木」を本当に照らせる。
 */

/** 手元の git で、同じ中身から木の名前を数える（製品では手元の作品のリポジトリで数える） */
async function localTree(files: Record<string, string>): Promise<string> {
  const lfs = fs();
  const dir = "/local";
  await lfs.promises.mkdir(dir);
  await git.init({ fs: lfs, dir, defaultBranch: "main" });
  for (const [path, s] of Object.entries(files)) {
    const parts = path.split("/");
    for (let i = 1; i < parts.length; i++) {
      await lfs.promises.mkdir(`${dir}/${parts.slice(0, i).join("/")}`).catch(() => undefined);
    }
    await lfs.promises.writeFile(`${dir}/${path}`, s);
    await git.add({ fs: lfs, dir, filepath: path });
  }
  const oid = await git.commit({ fs: lfs, dir, message: "x", author });
  return (await git.readCommit({ fs: lfs, dir, oid })).commit.tree;
}

const start = { "原稿/第1話.txt": "吾輩は猫である。\r\n", "原稿/第2話.txt": "名前はまだ無い。\n", "設定/characters.json": "{}\n" };

async function setup() {
  const gh = new FakeGitHub();
  const base = await gh.init(start);
  const input = (changes: FileChange[], extra: Partial<PushInput> = {}): PushInput => ({
    owner: "nonahisa",
    repo: "作品",
    branch: "main",
    token: "tkn",
    baseCommit: base.commit,
    changes,
    message: "スマホで書いた",
    author: { name: "作者", email: "author@example.invalid" },
    ...extra,
  });
  return { gh, base, input };
}

describe("送る", () => {
  test("書き換え・新しい話・消した話を1つの版にして、枝を早送りで進める", async () => {
    const { gh, base, input } = await setup();
    const after = { "原稿/第1話.txt": "吾輩は猫である。名前はまだ無い。\r\n", "原稿/第3話.txt": "どこで生れたか\n", "設定/characters.json": "{}\n" };
    const expectedTree = await localTree(after);
    const changes: FileChange[] = [
      { path: "原稿/第1話.txt", bytes: text(after["原稿/第1話.txt"]), oid: await git.hashBlob({ object: text(after["原稿/第1話.txt"]) }).then((r) => r.oid) },
      { path: "原稿/第3話.txt", bytes: text(after["原稿/第3話.txt"]) },
      { path: "原稿/第2話.txt", deleted: true },
    ];
    const result = await pushViaGitHubApi(input(changes, { expectedTree }), gh.fetch, "https://api.test");
    expect(result).toMatchObject({ kind: "pushed", tree: expectedTree });
    expect(await gh.files()).toEqual(after);
    // 版は前の版の上に1つだけ
    const { commit } = await git.readCommit({ fs: gh.fs, dir: gh.dir, oid: gh.head });
    expect(commit.parent).toEqual([base.commit]);
    expect(commit.message.trim()).toBe("スマホで書いた");
  });

  test("日本語の道は URL で崩さず、本文の CRLF と Shift_JIS のバイトもそのまま届く", async () => {
    const { gh, input } = await setup();
    const sjis = new Uint8Array([0x8c, 0xe1, 0x94, 0x79, 0x82, 0xcd, 0x94, 0x4c, 0x0d, 0x0a]); // 吾輩は猫\r\n（Shift_JIS）
    const result = await pushViaGitHubApi(input([{ path: "原稿/第1話.txt", bytes: sjis }]), gh.fetch, "https://api.test");
    expect(result.kind).toBe("pushed");
    const { commit } = await git.readCommit({ fs: gh.fs, dir: gh.dir, oid: gh.head });
    const { blob } = await git.readBlob({ fs: gh.fs, dir: gh.dir, oid: commit.tree, filepath: "原稿/第1話.txt" });
    expect([...blob]).toEqual([...sjis]);
    expect(gh.calls[0].path).toBe("/repos/nonahisa/作品/git/ref/heads/main");
  });

  test("変わっていなければ何も送らない", async () => {
    const { gh, base, input } = await setup();
    expect(await pushViaGitHubApi(input([]), gh.fetch, "https://api.test")).toEqual({ kind: "nothing_to_push" });
    const same = await pushViaGitHubApi(
      input([{ path: "原稿/第2話.txt", bytes: text(start["原稿/第2話.txt"]) }]),
      gh.fetch,
      "https://api.test"
    );
    expect(same).toEqual({ kind: "nothing_to_push" });
    expect(gh.head).toBe(base.commit);
    expect(gh.calls.some((c) => c.path.endsWith("/git/commits") && c.method === "POST")).toBe(false);
  });
});

describe("原稿を壊さない", () => {
  test("向こうが先へ進んでいたら、何も送らずに behind を返す", async () => {
    const { gh, base, input } = await setup();
    const other = await pushViaGitHubApi(input([{ path: "原稿/第2話.txt", bytes: text("パソコンで直した\n") }]), gh.fetch, "https://api.test");
    expect(other.kind).toBe("pushed");
    gh.calls.length = 0;
    const result = await pushViaGitHubApi(input([{ path: "原稿/第2話.txt", bytes: text("スマホで直した\n") }]), gh.fetch, "https://api.test");
    expect(result).toEqual({ kind: "behind", remoteHead: gh.head });
    expect(gh.head).not.toBe(base.commit);
    expect(gh.calls.map((c) => c.method)).toEqual(["GET"]);
    expect((await gh.files())["原稿/第2話.txt"]).toBe("パソコンで直した\n");
  });

  test("確かめたあとで、もう1台が先に送ったら（早送りでない）、枝を動かさずに behind", async () => {
    const { gh, input } = await setup();
    gh.raceBeforeUpdate = async () => {
      gh.raceBeforeUpdate = undefined;
      const r = await pushViaGitHubApi(input([{ path: "原稿/第2話.txt", bytes: text("パソコン\n") }]), gh.fetch, "https://api.test");
      expect(r.kind).toBe("pushed");
    };
    const result = await pushViaGitHubApi(input([{ path: "原稿/第1話.txt", bytes: text("スマホ\n") }]), gh.fetch, "https://api.test");
    expect(result).toEqual({ kind: "behind" });
    const files = await gh.files();
    expect(files["原稿/第2話.txt"]).toBe("パソコン\n");
    expect(files["原稿/第1話.txt"]).toBe(start["原稿/第1話.txt"]);
  });

  test("届いた中身の名前が手元と違えば（途中で CRLF になったなど）、版を作らずに止める", async () => {
    const { gh, base, input } = await setup();
    gh.mangleBlob = (bytes) => text(new TextDecoder().decode(bytes).replace(/\n/g, "\r\n"));
    const bytes = text("一行目\n二行目\n");
    const oid = (await git.hashBlob({ object: bytes })).oid;
    const result = await pushViaGitHubApi(input([{ path: "原稿/第1話.txt", bytes, oid }]), gh.fetch, "https://api.test");
    expect(result).toEqual({ kind: "failed", error: { kind: "hash_mismatch", step: "blob", path: "原稿/第1話.txt" } });
    expect(gh.head).toBe(base.commit);
  });

  test("組んだ木が手元の木と違えば、版を作らずに止める", async () => {
    const { gh, base, input } = await setup();
    // 手元では第2話も消したつもりなのに、送る変更に入れ忘れた
    const expectedTree = await localTree({ "原稿/第1話.txt": "新\n", "設定/characters.json": "{}\n" });
    const result = await pushViaGitHubApi(
      input([{ path: "原稿/第1話.txt", bytes: text("新\n") }], { expectedTree }),
      gh.fetch,
      "https://api.test"
    );
    expect(result).toEqual({ kind: "failed", error: { kind: "hash_mismatch", step: "tree" } });
    expect(gh.head).toBe(base.commit);
  });

  test("作品の外を指す道・同じ道の重なりは、何も送らずに断る", async () => {
    const { gh, input } = await setup();
    for (const path of ["../外.txt", "/根.txt", "原稿\\第1話.txt", "原稿//a", "原稿/", ""]) {
      expect(isSafeRepoPath(path)).toBe(false);
      const r = await pushViaGitHubApi(input([{ path, bytes: text("x") }]), gh.fetch, "https://api.test");
      expect(r).toMatchObject({ kind: "failed", error: { kind: "bad_change" } });
    }
    const dup = await pushViaGitHubApi(
      input([{ path: "a.txt", bytes: text("1") }, { path: "a.txt", deleted: true }]),
      gh.fetch,
      "https://api.test"
    );
    expect(dup).toMatchObject({ kind: "failed", error: { kind: "bad_change" } });
    expect(gh.calls).toEqual([]);
  });
});

describe("失敗は種類だけを返す（黙って送り直さない）", () => {
  test.each([
    [401, "sign_in_again"],
    [403, "no_access"],
    [404, "no_access"],
    [429, "rate_limited"],
    [502, "server"],
    [400, "unknown"],
  ] as const)("状態 %i → %s", async (status, kind) => {
    const { gh, base, input } = await setup();
    gh.failAt.commit = status;
    const result = await pushViaGitHubApi(input([{ path: "原稿/第1話.txt", bytes: text("x") }]), gh.fetch, "https://api.test");
    expect(result).toEqual({ kind: "failed", error: { kind, step: "commit", status } });
    expect(gh.head).toBe(base.commit);
    expect(gh.calls.filter((c) => c.path.endsWith("/git/commits") && c.method === "POST")).toHaveLength(1);
    expect(nextAction(kind).length).toBeGreaterThan(0);
  });

  test("つながらないときは offline", async () => {
    const { gh, input } = await setup();
    gh.offline = true;
    const result = await pushViaGitHubApi(input([{ path: "a.txt", bytes: text("x") }]), gh.fetch, "https://api.test");
    expect(result).toEqual({ kind: "failed", error: { kind: "offline", step: "ref" } });
  });

  test("枝を進める口が 422 以外で断れば、その種類を返す", async () => {
    const { gh, base, input } = await setup();
    gh.failAt.update_ref = 403;
    const result = await pushViaGitHubApi(input([{ path: "a.txt", bytes: text("x") }]), gh.fetch, "https://api.test");
    expect(result).toEqual({ kind: "failed", error: { kind: "no_access", step: "update_ref", status: 403 } });
    expect(gh.head).toBe(base.commit);
  });
});
