import "../src/platform/bufferShim";
import git from "isomorphic-git";
import { describe, expect, test } from "vitest";
import { MemoryGitFsBackend, createGitFs } from "../src/platform/gitFs";
import { latestUnsentTime, readWorkSync, workRepo } from "../src/platform/workSync";
import { noteTouched } from "../src/platform/touchedPaths";
import { author } from "./support/fakeGitHub";
import { syncFlag } from "../src/app/workListView";

/** 作品の同期の状態（`src/platform/workSync.ts`。設計書 6章）。作品は作り物（`_確認用`）だけ */

type Fs = ReturnType<typeof createGitFs>;
const utf8 = (s: string) => new TextEncoder().encode(s);
const BASE = "/works";

async function write(fs: Fs, path: string, text: string): Promise<void> {
  const parts = path.split("/");
  let folder = BASE;
  for (const part of parts.slice(0, -1)) {
    folder = `${folder}/${part}`;
    await fs.promises.mkdir(folder).catch(() => undefined);
  }
  await fs.promises.writeFile(`${BASE}/${path}`, utf8(text));
}

async function repo(name: string, files: Record<string, string>) {
  const backend = new MemoryGitFsBackend(1_000);
  const fs = createGitFs(backend);
  await fs.promises.mkdir(BASE);
  await fs.promises.mkdir(`${BASE}/${name}`);
  const dir = `${BASE}/${name}`;
  await git.init({ fs, dir, defaultBranch: "main" });
  for (const [path, text] of Object.entries(files)) {
    await write(fs, `${name}/${path}`, text);
    await git.add({ fs, dir, filepath: path });
  }
  await git.commit({ fs, dir, message: "はじめ\n", author, committer: author });
  return fs;
}

describe("作品の同期の状態", () => {
  test("リポジトリは置き場の直下。書庫の中の作品はその中のフォルダー", () => {
    expect(workRepo("灯台守_確認用", BASE)).toEqual({ dir: "/works/灯台守_確認用", prefix: "" });
    expect(workRepo("書庫_確認用/港_確認用")).toEqual({ dir: "/書庫_確認用", prefix: "港_確認用/" });
  });

  test("git で持っていない作品は出さない（undefined）。そろっていれば送っていない話は無い", async () => {
    const fs = await repo("灯台守_確認用", { "本文/第1話.txt": "一\n" });
    await fs.promises.mkdir(`${BASE}/手元だけ_確認用`);
    expect(await readWorkSync(fs, "手元だけ_確認用", BASE)).toBeUndefined();
    expect(await readWorkSync(fs, "灯台守_確認用", BASE)).toEqual({ unsent: [], otherCount: 0 });
  });

  test("書き換えた・足した・消した話を数え、設定の変更は別に数える。書いた時刻も添える", async () => {
    const fs = await repo("灯台守_確認用", { "本文/第1話.txt": "一\n", "本文/第2話.txt": "二\n", "設定/characters.json": "{}\n" });
    await write(fs, "灯台守_確認用/本文/第1話.txt", "一。書き足した\n");
    await write(fs, "灯台守_確認用/本文/第3話.txt", "三\n");
    await fs.promises.unlink(`${BASE}/灯台守_確認用/本文/第2話.txt`);
    await write(fs, "灯台守_確認用/設定/characters.json", "{\"a\":1}\n");
    const state = await readWorkSync(fs, "灯台守_確認用", BASE);
    expect(state!.unsent.map((f) => [f.path, f.deleted])).toEqual([
      ["灯台守_確認用/本文/第1話.txt", false],
      ["灯台守_確認用/本文/第2話.txt", true],
      ["灯台守_確認用/本文/第3話.txt", false],
    ]);
    expect(state!.otherCount).toBe(1);
    expect(state!.unsent[0]!.mtimeMs).toEqual(expect.any(Number));
    expect(latestUnsentTime(state)).toBe(Math.max(state!.unsent[0]!.mtimeMs!, state!.unsent[2]!.mtimeMs!));
    expect(latestUnsentTime({ unsent: [], otherCount: 0 })).toBeUndefined();
  });

  test("書き戻しの退避（.gitignore で外していなくても）は数えない", async () => {
    const fs = await repo("灯台守_確認用", { "本文/第1話.txt": "一\n" });
    await write(fs, "灯台守_確認用/本文/.novelai-recovery/a.bak", "前の本文\n");
    expect(await readWorkSync(fs, "灯台守_確認用", BASE)).toEqual({ unsent: [], otherCount: 0 });
  });

  test("同じ秒に同じ大きさで書き換えても、アプリが書いた話（名指しの控え）なら数える", async () => {
    const backend = new MemoryGitFsBackend(0); // 時計が進まない＝同じ秒
    const fs = createGitFs(backend);
    await fs.promises.mkdir(BASE);
    const dir = `${BASE}/灯台守_確認用`;
    await fs.promises.mkdir(dir);
    await git.init({ fs, dir, defaultBranch: "main" });
    await write(fs, "灯台守_確認用/本文/第1話.txt", "一つ目\n");
    await git.add({ fs, dir, filepath: "本文/第1話.txt" });
    await git.commit({ fs, dir, message: "はじめ\n", author, committer: author });
    await write(fs, "灯台守_確認用/本文/第1話.txt", "二つ目\n"); // 同じバイト数
    // isomorphic-git は大きさと時刻で見るので見落とす
    expect(await readWorkSync(fs, "灯台守_確認用", BASE)).toEqual({ unsent: [], otherCount: 0 });
    await noteTouched(fs, dir, "本文/第1話.txt");
    expect((await readWorkSync(fs, "灯台守_確認用", BASE))!.unsent.map((f) => f.path)).toEqual(["灯台守_確認用/本文/第1話.txt"]);
  });

  test("書庫の中の作品は、その作品の変更だけを数える", async () => {
    const fs = await repo("書庫_確認用", { "港_確認用/本文/第1話.txt": "港\n", "灯_確認用/本文/第1話.txt": "灯\n" });
    await write(fs, "書庫_確認用/港_確認用/本文/第1話.txt", "港。書き足した\n");
    expect((await readWorkSync(fs, "書庫_確認用/港_確認用", BASE))!.unsent.map((f) => f.path)).toEqual(["書庫_確認用/港_確認用/本文/第1話.txt"]);
    expect(await readWorkSync(fs, "書庫_確認用/灯_確認用", BASE)).toEqual({ unsent: [], otherCount: 0 });
  });
});

describe("同期の状態の印", () => {
  test("送っていない話の数・ほかの変更だけ・同期済み・git で持っていなければ出さない", () => {
    const file = { path: "灯台守_確認用/本文/第1話.txt", deleted: false };
    expect(syncFlag({ unsent: [file], otherCount: 2 })).toEqual({ text: "送っていない話：1", tone: "warn" });
    expect(syncFlag({ unsent: [], otherCount: 2 })).toEqual({ text: "送っていない変更：2", tone: "warn" });
    expect(syncFlag({ unsent: [], otherCount: 0 })).toEqual({ text: "同期済み", tone: "ok" });
    expect(syncFlag(undefined)).toBeUndefined();
  });
});
