import "../src/platform/bufferShim";
import git from "isomorphic-git";
import { describe, expect, test } from "vitest";
import { MemoryFileStore } from "../src/platform/memoryFileStore";
import { MemoryGitFsBackend, createGitFs } from "../src/platform/gitFs";
import { renamePlotHeading, renameWork } from "../src/platform/workRename";
import { checkRemovable, removeWorkFolder } from "../src/platform/workRemove";
import { journalPathFor } from "../src/app/draftJournal";
import { author } from "./support/fakeGitHub";

/**
 * 作品の長押し（2026-11-18 作者の答え）：題を変える（設定ファイルが無ければ作る）・登録から外す（送っていないものがあれば外さない）。
 * 作者のデータを書く・消す道なので、書く前に落ちる試しを先に置く。作品は作り物（`_確認用`）だけ
 */
const utf8 = (s: string) => new TextEncoder().encode(s);
const text = (store: MemoryFileStore, path: string) => new TextDecoder().decode(store.peek(path)!);
const ROOT = "灯台守_確認用";
const CONFIG = `${ROOT}/.aiwriter/config.json`;
const PLOT = `${ROOT}/設定/plot.md`;

describe("題を変える", () => {
  test("設定ファイルがあれば workTitle だけを替え、ほかの欄と改行の形（CRLF・末尾）は保つ。元は退避する", async () => {
    const store = new MemoryFileStore();
    const before = '{\r\n  "schemaVersion": "0.1",\r\n  "workTitle": "灯台守",\r\n  "manuscriptDir": "本文"\r\n}';
    store.putExternally(CONFIG, utf8(before));
    expect(await renameWork(store, ROOT, "霧笛の灯台")).toEqual({ kind: "renamed", notes: [] });
    const after = text(store, CONFIG);
    expect(JSON.parse(after)).toEqual({ schemaVersion: "0.1", workTitle: "霧笛の灯台", manuscriptDir: "本文" });
    expect(after).toContain("\r\n");
  });
  test("設定ファイルが無ければ、題だけの設定ファイルを作る（本文と設定の置き場は書かない）", async () => {
    const store = new MemoryFileStore();
    expect((await renameWork(store, ROOT, "霧笛の灯台")).kind).toBe("renamed");
    expect(JSON.parse(text(store, CONFIG))).toEqual({ schemaVersion: "0.1", workTitle: "霧笛の灯台" });
  });
  test("壊れた設定ファイルは直さずに止める（書かない）", async () => {
    const store = new MemoryFileStore();
    store.putExternally(CONFIG, utf8("{ 壊れ"));
    expect((await renameWork(store, ROOT, "新しい題")).kind).toBe("failed");
    expect(text(store, CONFIG)).toBe("{ 壊れ");
  });
  test("同じ題・空の題は何もしない", async () => {
    const store = new MemoryFileStore();
    expect(await renameWork(store, ROOT, ROOT)).toEqual({ kind: "unchanged" });
    expect((await renameWork(store, ROOT, "  ")).kind).toBe("failed");
    expect(store.peek(CONFIG)).toBeUndefined();
  });
  test("プロットの先頭の見出しが元の題なら替える。作者が書き換えた見出しは触らずに知らせる", async () => {
    const store = new MemoryFileStore();
    store.putExternally(PLOT, utf8("# 灯台守_確認用\n\n## あらすじ\n"));
    await renameWork(store, ROOT, "霧笛の灯台");
    expect(text(store, PLOT)).toBe("# 霧笛の灯台\n\n## あらすじ\n");
    const other = new MemoryFileStore();
    other.putExternally(PLOT, utf8("# 作者が付けた見出し\n"));
    expect(await renameWork(other, ROOT, "霧笛の灯台")).toEqual({ kind: "renamed", notes: ["プロットの見出しは元の題と違ったので変えていません"] });
    expect(text(other, PLOT)).toBe("# 作者が付けた見出し\n");
  });
  test("見出しの替え方は本体と同じ（## は題と読まない）", () => {
    expect(renamePlotHeading("## 節\n# 題\n", "題", "新")).toEqual({ text: "## 節\n# 新\n", changed: true });
    expect(renamePlotHeading("# 別\n", "題", "新").changed).toBe(false);
  });
});

async function gitWork(name: string, files: Record<string, string>) {
  const backend = new MemoryGitFsBackend(1_000);
  const fs = createGitFs(backend);
  await fs.promises.mkdir("/works");
  await fs.promises.mkdir(`/works/${name}`);
  const dir = `/works/${name}`;
  await git.init({ fs, dir, defaultBranch: "main" });
  for (const [path, body] of Object.entries(files)) {
    const parts = path.split("/");
    let folder = dir;
    for (const part of parts.slice(0, -1)) {
      folder = `${folder}/${part}`;
      await fs.promises.mkdir(folder).catch(() => undefined);
    }
    await fs.promises.writeFile(`${dir}/${path}`, utf8(body));
    await git.add({ fs, dir, filepath: path });
  }
  await git.commit({ fs, dir, message: "はじめ\n", author, committer: author });
  return { backend, fs };
}

describe("登録から外す", () => {
  const files = { "本文/第1話.txt": "姉から手紙が届いた。" };
  const storeOf = () => {
    const store = new MemoryFileStore();
    store.putExternally(`${ROOT}/本文/第1話.txt`, utf8("姉から手紙が届いた。"));
    return store;
  };
  test("送っていないものが無ければ外せる。外すとフォルダーごと消える", async () => {
    const { backend, fs } = await gitWork(ROOT, files);
    expect(await checkRemovable(storeOf(), fs, ROOT, "/works")).toEqual({ ok: true });
    await removeWorkFolder(backend, ROOT, "/works");
    expect(await backend.stat(`/works/${ROOT}`)).toBeUndefined();
  });
  test("送っていない話があれば外さない", async () => {
    const { fs } = await gitWork(ROOT, files);
    await fs.promises.writeFile(`/works/${ROOT}/本文/第1話.txt`, utf8("書き足した。"));
    const check = await checkRemovable(storeOf(), fs, ROOT, "/works");
    expect(check.ok).toBe(false);
    expect(check.ok ? "" : check.reason).toContain("送っていない話が 1 話");
  });
  test("GitHub と結んでいない作品（git の置き場が無い）は外さない", async () => {
    const fs = createGitFs(new MemoryGitFsBackend(1_000));
    const check = await checkRemovable(storeOf(), fs, ROOT, "/works");
    expect(check.ok ? "" : check.reason).toContain("GitHub と結んでいない");
  });
  test("保存していない書きかけ（控え）がある話があれば外さない", async () => {
    const { fs } = await gitWork(ROOT, files);
    const store = storeOf();
    store.putExternally(journalPathFor(`${ROOT}/本文/第1話.txt`), utf8("書きかけ"));
    const check = await checkRemovable(store, fs, ROOT, "/works");
    expect(check.ok ? "" : check.reason).toContain("保存していない書きかけ");
  });
  test("書庫の中の作品は外さない", async () => {
    const { fs } = await gitWork("書庫_確認用", files);
    expect((await checkRemovable(storeOf(), fs, "書庫_確認用/港_確認用", "/works")).ok).toBe(false);
  });
});
