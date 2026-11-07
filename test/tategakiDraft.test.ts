import { describe, expect, test } from "vitest";
import { MemoryFileStore } from "../src/platform/memoryFileStore";
import { readTextFile } from "../src/platform/textFile";
import { DRAFT_PATH, SAMPLE_TEXT, countLabel, loadDraft, previewHtml, saveDraft, saveFailureMessage } from "../src/app/tategakiDraft";

/**
 * 縦書きの試し（作者の頼み 2026-11-07）。表示・字数は本体の部品、保存は本体の決まり
 * （`writeTextFilePreservingFormat`）で書き戻すことを見張る。
 */

const sjis = (bytes: number[]) => new Uint8Array(bytes);

describe("ルビと傍点の表示", () => {
  test("{漢字|かんじ} はルビ、{{語}} は傍点、改行は <br>", () => {
    const html = previewHtml("{吾輩|わがはい}は{{猫}}である。\n名前");
    expect(html).toBe(
      '<ruby>吾輩<rt>わがはい</rt></ruby>は<span style="text-emphasis: filled dot; -webkit-text-emphasis: filled dot;">猫</span>である。<br>名前'
    );
  });

  test("地の文の < & はタグにしない（打った字のまま見える）", () => {
    expect(previewHtml("a<b>&{漢|か}")).toBe("a&lt;b&gt;&amp;<ruby>漢<rt>か</rt></ruby>");
  });

  test("閉じていない記法は、そのまま字として出す", () => {
    expect(previewHtml("{漢字|かんじ")).toBe("{漢字|かんじ");
  });
});

describe("字数（本体と同じ数え方）", () => {
  test("改行とルビの読み・記法の印は数えない。空白を除いた数も出す", () => {
    // 吾輩は猫である。＝8字、全角空白1、名前＝2字
    expect(countLabel("{吾輩|わがはい}は{{猫}}である。\n　名前")).toBe("11 字（空白を除くと 10 字）");
  });
  test("見本の文も数えられる", () => {
    expect(countLabel(SAMPLE_TEXT)).toMatch(/^\d+ 字（空白を除くと \d+ 字）$/);
  });
});

describe("保存と読み戻し（本体の決まりで書き戻す）", () => {
  test("はじめては UTF-8・LF で新しく作り、読み戻した本文が同じ", async () => {
    const store = new MemoryFileStore();
    expect(await loadDraft(store)).toBeUndefined();
    const saved = await saveDraft(store, "縦書きの\n試し", undefined);
    expect(saved).toMatchObject({ ok: true, same: true, created: true });
    const back = await readTextFile(store, DRAFT_PATH);
    expect(back).toMatchObject({ encoding: "utf8", eol: "\n", text: "縦書きの\n試し\n" });
  });

  test("2回目からは前と同じ形で書き戻し、前の中身の写しを残す", async () => {
    const store = new MemoryFileStore();
    const first = await saveDraft(store, "一回目", undefined);
    if (!first.ok) throw new Error("一回目が通らない");
    const second = await saveDraft(store, "二回目の原稿", first.readBack);
    expect(second).toMatchObject({ ok: true, same: true, created: false });
    if (!second.ok) return;
    expect(second.recoveryPath).toMatch(/\.novelai-recovery\/.+\.bak$/);
    expect((await readTextFile(store, DRAFT_PATH)).text).toBe("二回目の原稿\n");
  });

  test("Shift_JIS・CRLF の原稿は、Shift_JIS・CRLF のまま書き戻す", async () => {
    const store = new MemoryFileStore();
    await store.createDirectory("試し");
    // 「猫\r\n」（Shift_JIS）
    await store.writeFile(DRAFT_PATH, sjis([0x94, 0x4c, 0x0d, 0x0a]), { mode: "create" });
    const loaded = await loadDraft(store);
    expect(loaded).toMatchObject({ encoding: "shift_jis", eol: "\r\n" });
    const saved = await saveDraft(store, "犬\n猫", loaded);
    expect(saved).toMatchObject({ ok: true, same: true });
    expect([...(await store.readFile(DRAFT_PATH))]).toEqual([0x8c, 0xa2, 0x0d, 0x0a, 0x94, 0x4c, 0x0d, 0x0a]);
  });

  test("読んだあとで外から書き換えられていたら、上書きしない", async () => {
    const store = new MemoryFileStore();
    const first = await saveDraft(store, "最初", undefined);
    if (!first.ok) throw new Error("最初が通らない");
    // ほかの所が書き換えた
    await store.deleteFile(DRAFT_PATH);
    await store.writeFile(DRAFT_PATH, new TextEncoder().encode("ほかの所\n"), { mode: "create" });
    const saved = await saveDraft(store, "こちらの書き換え", first.readBack);
    expect(saved).toEqual({ ok: false, reason: "modified_externally", detail: undefined });
    expect((await readTextFile(store, DRAFT_PATH)).text).toBe("ほかの所\n");
    expect(saveFailureMessage("modified_externally")).toContain("上書きしないで止めました");
  });

  test("はじめての保存のとき、もう在れば上書きしない", async () => {
    const store = new MemoryFileStore();
    await store.createDirectory("試し");
    await store.writeFile(DRAFT_PATH, new TextEncoder().encode("在った\n"), { mode: "create" });
    expect(await saveDraft(store, "新しい", undefined)).toMatchObject({ ok: false, reason: "modified_externally" });
    expect((await readTextFile(store, DRAFT_PATH)).text).toBe("在った\n");
  });

  test("git の食い違いの印が入っていたら書かない", async () => {
    const store = new MemoryFileStore();
    const first = await saveDraft(store, "最初", undefined);
    if (!first.ok) throw new Error("最初が通らない");
    const saved = await saveDraft(store, "<<<<<<< HEAD\nあ\n=======\nい\n>>>>>>> x", first.readBack);
    expect(saved).toMatchObject({ ok: false, reason: "conflict_markers" });
  });
});
