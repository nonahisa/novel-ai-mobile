import { describe, expect, test } from "vitest";
import { MemoryFileStore } from "../src/platform/memoryFileStore";
import { journalPathFor } from "../src/app/draftJournal";
import { draftPreview, listOrphanDrafts } from "../src/app/orphanDrafts";

/** 設定 → 書きかけの控え（2026-11-18 作者の答え「一覧にして、1つずつ消せるようにする（自動では消さない）」） */
const utf8 = (text: string) => new TextEncoder().encode(text);

describe("どの話にも合わない控え", () => {
  test("いまある話の控えは並べない。頭の行（もとの本文のハッシュ）は除いて読む", async () => {
    const store = new MemoryFileStore();
    const live = journalPathFor("作品/本文/第1話.txt");
    const orphan = journalPathFor("消えた/本文/第1話.txt");
    store.putExternally(live, utf8("いまの話"));
    store.putExternally(orphan, utf8(`#novelai-draft base=${"a".repeat(64)}\n残った書きかけ`));
    const list = await listOrphanDrafts(store, new Set([live]));
    expect(list).toEqual([{ file: orphan, text: "残った書きかけ" }]);
  });
  test("控えの置き場が無ければ空", async () => {
    expect(await listOrphanDrafts(new MemoryFileStore(), new Set())).toEqual([]);
  });
});

describe("中身の頭", () => {
  test("空でない行から2行、60字まで", () => {
    expect(draftPreview("\n一行目\n\n二行目\n三行目")).toBe("一行目　二行目");
    expect(draftPreview("あ".repeat(70))).toBe(`${"あ".repeat(60)}…`);
    expect(draftPreview("")).toBe("");
  });
});
