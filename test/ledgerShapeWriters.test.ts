import { describe, expect, test } from "vitest";
import { emptySynopsisSet } from "../src/shared";
import { MemoryFileStore } from "../src/platform/memoryFileStore";
import { renameWork } from "../src/platform/workRename";
import { writeWorkSeries } from "../src/platform/workSeries";
import { writePlotBasics, writeWorkKind, writeWorkMemoMarkers } from "../src/platform/workSettings";
import { loadSynopses, saveSynopses } from "../src/platform/synopsisStore";
import { planChapter, saveChapter } from "../src/app/newChapter";

/**
 * **台帳を書く口の頭に、形の関所**（2026-11-21 作者の答え「台帳の形が変わったときだけ止める」）。
 * モバイル版の知らない新しい形の台帳は、どの口からも書かない（本体で増えた欄を同期で消さない）。作品は作り物（`_確認用`）だけ
 */
const utf8 = (s: string) => new TextEncoder().encode(s);
const text = (store: MemoryFileStore, path: string) => new TextDecoder().decode(store.peek(path)!);
const ROOT = "灯台守_確認用";
const CONFIG = `${ROOT}/.aiwriter/config.json`;
const NEWER_CONFIG = '{"schemaVersion":"9.0","workTitle":"灯台守","futureField":{"a":1}}';

describe("作品の設定ファイル（新しい形なら書かない）", () => {
  const fresh = () => {
    const store = new MemoryFileStore();
    store.putExternally(CONFIG, utf8(NEWER_CONFIG));
    return store;
  };
  test("題を変える", async () => {
    const store = fresh();
    const outcome = await renameWork(store, ROOT, "霧笛");
    expect(outcome.kind).toBe("failed");
    if (outcome.kind === "failed") expect(outcome.message).toContain("作品の設定の形が新しくなっています");
    expect(text(store, CONFIG)).toBe(NEWER_CONFIG);
  });
  test("シリーズ・メモの印・作品の種類", async () => {
    const store = fresh();
    expect((await writeWorkSeries(store, ROOT, { name: "灯台", related: ["雪の駅_確認用"] })).ok).toBe(false);
    expect((await writeWorkMemoMarkers(store, ROOT, ["percent"])).ok).toBe(false);
    expect((await writeWorkKind(store, ROOT, "script")).ok).toBe(false);
    expect(text(store, CONFIG)).toBe(NEWER_CONFIG);
  });
  test("形式・ジャンルで「脚本」の種類を書き留めるときも、設定は書かない（プロットは書く）", async () => {
    const store = fresh();
    store.putExternally(`${ROOT}/設定/plot.md`, utf8("# 灯台守\n\n## 形式\n\n脚本\n"));
    expect((await writePlotBasics(store, ROOT, "長編", undefined)).ok).toBe(true);
    expect(text(store, CONFIG)).toBe(NEWER_CONFIG);
  });
  test("知っている形なら、これまでどおり書く", async () => {
    const store = new MemoryFileStore();
    store.putExternally(CONFIG, utf8('{"schemaVersion":"0.1","workTitle":"灯台守"}'));
    expect((await writeWorkKind(store, ROOT, "script")).ok).toBe(true);
    expect(JSON.parse(text(store, CONFIG)).kind).toBe("script");
  });
});

describe("各話あらすじ・章立て（新しい形なら書かない）", () => {
  test("各話あらすじ", async () => {
    const store = new MemoryFileStore();
    const path = `${ROOT}/設定/chapter_synopses.json`;
    const newer = '{"schemaVersion":"9.0","episodes":[]}';
    store.putExternally(path, utf8(newer));
    const loaded = await loadSynopses(store, `${ROOT}/設定`);
    const saved = await saveSynopses(store, `${ROOT}/設定`, emptySynopsisSet(), loaded);
    expect(saved.ok).toBe(false);
    expect(text(store, path)).toBe(newer);
  });
  test("章立て", async () => {
    const store = new MemoryFileStore();
    const path = `${ROOT}/設定/章立て.json`;
    const newer = '{"schemaVersion":"9","chapters":[]}';
    store.putExternally(path, utf8(newer));
    store.putExternally(`${ROOT}/本文/第1話 手紙.txt`, utf8("姉から手紙が届いた。\n"));
    const plan = await planChapter(store, ROOT, `${ROOT}/本文/第1話 手紙.txt`);
    await expect(saveChapter(store, plan, "第一章")).rejects.toThrow("章立ての形が新しくなっています");
    expect(text(store, path)).toBe(newer);
  });
});
