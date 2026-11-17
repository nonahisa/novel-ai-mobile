import { describe, expect, it } from "vitest";
import { emptyCharacter } from "novel-ai-assistant/src/models/character";
import { emptyLocation } from "novel-ai-assistant/src/models/location";
import { emptyAbility } from "novel-ai-assistant/src/models/ability";
import { emptyOrganization } from "novel-ai-assistant/src/models/organization";
import { MemoryFileStore } from "../src/platform/memoryFileStore";
import { readSeriesTerms, readWorkTerms } from "../src/platform/workTerms";

const encode = (value: unknown) => new TextEncoder().encode(typeof value === "string" ? value : JSON.stringify(value));

/** 作り物の作品（`灯台守_確認用`）の設定資料 */
async function fixture(): Promise<MemoryFileStore> {
  const store = new MemoryFileStore();
  const put = (path: string, value: unknown) => store.putExternally(`灯台守_確認用/設定/${path}`, encode(value));
  put("characters/char_001.json", { ...emptyCharacter("char_001", "マルキオ・イークェス"), aliases: ["灯守"], summary: "灯台の番人" });
  put("characters/char_002.json", { ...emptyCharacter("char_002", "通りすがりの漁師"), isMob: true });
  put("characters/_index.json", { note: "読まない" });
  put("characters/char_003.json", "{ 壊れた JSON");
  put("locations/loc_001.json", { ...emptyLocation("loc_001", "北の岬・灯台"), aliases: [] });
  put("abilities/abil_001.json", { ...emptyAbility("abil_001", "灯の加護"), aliases: ["加護"] });
  put("organizations/org_001.json", { ...emptyOrganization("org_001", "冒険者ギルド"), aliases: [] });
  put("organizations/memo.txt", "読まない");
  return store;
}

describe("作品の設定資料から用語の色の語を作る（本体の TermHighlighter.load と同じ作り方）", () => {
  it("人物は名前と別名を広げ、モブは除く", async () => {
    const { entries } = await readWorkTerms(await fixture(), "灯台守_確認用/設定");
    const people = entries.filter((e) => e.kind === "character").map((e) => e.text);
    expect(people).toEqual(expect.arrayContaining(["マルキオ・イークェス", "マルキオ", "灯守"]));
    expect(people).not.toContain("通りすがりの漁師");
    const marukio = entries.find((e) => e.text === "マルキオ")!;
    expect(marukio).toMatchObject({ id: "char_001", canonicalName: "マルキオ・イークェス", summary: "灯台の番人" });
  });

  it("組織・能力は名前を割らない。場所は広げる", async () => {
    const { entries } = await readWorkTerms(await fixture(), "灯台守_確認用/設定");
    const of = (kind: string) => entries.filter((e) => e.kind === kind).map((e) => e.text);
    expect(of("organization")).toEqual(["冒険者ギルド"]);
    expect(of("ability")).toEqual(["灯の加護", "加護"]);
    expect(of("location")).toContain("北の岬・灯台");
  });

  it("壊れた1件は飛ばして残りを読み、訳を返す。_ で始まるもの・.json 以外は読まない", async () => {
    const { entries, errors } = await readWorkTerms(await fixture(), "灯台守_確認用/設定");
    expect(errors.map((e) => e.file)).toEqual(["characters/char_003.json"]);
    expect(entries.some((e) => e.id === "char_001")).toBe(true);
  });

  it("設定フォルダーが無ければ0件（止めない）", async () => {
    const { entries, errors } = await readWorkTerms(new MemoryFileStore(), "無い作品/設定");
    expect(entries).toEqual([]);
    expect(errors).toEqual([]);
  });

  it("ファイル名と ID が合わない1件は読まない（本体と同じ）", async () => {
    const store = new MemoryFileStore();
    store.putExternally("w/設定/characters/other.json", encode(emptyCharacter("char_009", "灯")));
    const { entries, errors } = await readWorkTerms(store, "w/設定");
    expect(entries).toEqual([]);
    expect(errors[0].message).toContain("一致しません");
  });

  it("設定へは書かない", async () => {
    const store = await fixture();
    const before = JSON.stringify(await store.listEntries("灯台守_確認用/設定/characters"));
    await readWorkTerms(store, "灯台守_確認用/設定");
    expect(JSON.stringify(await store.listEntries("灯台守_確認用/設定/characters"))).toBe(before);
  });
});

/**
 * シリーズでつないだ作品の語（本体の設計書 6.95.3・`core/seriesSettings.ts` の `loadSeriesTerms`）。
 * 作り物の作品 `灯台守_確認用`（本編）と `灯台守外伝_確認用`（つないだ相手）
 */
async function seriesFixture(parent = ""): Promise<MemoryFileStore> {
  const store = new MemoryFileStore();
  const at = (path: string) => (parent ? `${parent}/${path}` : path);
  const put = (path: string, value: unknown) => store.putExternally(at(path), encode(value));
  put("灯台守_確認用/.aiwriter/config.json", { workTitle: "灯台守", series: { name: "灯台守", related: ["灯台守外伝_確認用", "../外", "灯台守_確認用", "無い作品"] } });
  put("灯台守_確認用/設定/characters/char_001.json", { ...emptyCharacter("char_001", "マルキオ・イークェス"), summary: "本編の紹介" });
  put("灯台守外伝_確認用/.aiwriter/config.json", { workTitle: "灯台守外伝" });
  put("灯台守外伝_確認用/設定/characters/char_001.json", { ...emptyCharacter("char_001", "セラ・ノーム"), aliases: ["坊ちゃん"], reading: "せら・のーむ", summary: "外伝の秘密" });
  put("灯台守外伝_確認用/設定/characters/char_002.json", { ...emptyCharacter("char_002", "未来の王"), status: "未登場" });
  put("灯台守外伝_確認用/設定/characters/char_003.json", { ...emptyCharacter("char_003", "影の参謀"), spoilerLevel: "author_only" });
  put("灯台守外伝_確認用/設定/characters/char_004.json", { ...emptyCharacter("char_004", "通りすがりの漁師"), isMob: true });
  put("灯台守外伝_確認用/設定/characters/char_005.json", "{ 壊れた JSON");
  put("灯台守外伝_確認用/設定/locations/loc_001.json", { ...emptyLocation("loc_001", "南の港"), aliases: [] });
  put("外/設定/characters/char_001.json", { ...emptyCharacter("char_001", "外の人") });
  return store;
}

describe("シリーズでつないだ作品の語も色を付ける（本体の loadSeriesTerms と同じ）", () => {
  it("相手の公開・登場済みの名前と別名だけを借り、紹介は相手の中身でなく出どころにする", async () => {
    const terms = await readSeriesTerms(await seriesFixture(), "灯台守_確認用");
    expect(terms.map((t) => t.text)).toEqual(["セラ・ノーム", "坊ちゃん", "南の港"]);
    expect(terms[1]).toMatchObject({ kind: "character", id: "series:character:セラ・ノーム", canonicalName: "セラ・ノーム", summary: "灯台守外伝にも出てきます" });
    expect(JSON.stringify(terms)).not.toContain("外伝の秘密");
  });

  it("未登場・公開でない・モブ・壊れた1件は借りない。名前は広げない（本体と同じ）", async () => {
    const texts = (await readSeriesTerms(await seriesFixture(), "灯台守_確認用")).map((t) => t.text);
    for (const hidden of ["未来の王", "影の参謀", "通りすがりの漁師", "セラ"]) expect(texts).not.toContain(hidden);
  });

  it("書庫の中の作品でも、隣の作品を読む。.. や自分自身・無い作品は読まない", async () => {
    const terms = await readSeriesTerms(await seriesFixture("書庫"), "書庫/灯台守_確認用");
    expect(terms.map((t) => t.text)).toEqual(["セラ・ノーム", "坊ちゃん", "南の港"]);
    expect(terms.some((t) => t.text === "外の人" || t.text === "マルキオ・イークェス")).toBe(false);
  });

  it("series が無い・壊れている・設定が無ければ0件（止めない）", async () => {
    const store = await seriesFixture();
    expect(await readSeriesTerms(store, "灯台守外伝_確認用")).toEqual([]);
    expect(await readSeriesTerms(new MemoryFileStore(), "無い作品")).toEqual([]);
    store.putExternally("壊れ/.aiwriter/config.json", encode("{ 壊れた"));
    expect(await readSeriesTerms(store, "壊れ")).toEqual([]);
  });

  it("相手の題が無ければフォルダー名を出どころにする", async () => {
    const store = await seriesFixture();
    store.putExternally("灯台守外伝_確認用/.aiwriter/config.json", encode({}));
    const terms = await readSeriesTerms(store, "灯台守_確認用");
    expect(terms[0].summary).toBe("灯台守外伝_確認用にも出てきます");
  });

  it("相手の資料へは書かない", async () => {
    const store = await seriesFixture();
    const before = JSON.stringify(await store.listEntries("灯台守外伝_確認用/設定/characters"));
    await readSeriesTerms(store, "灯台守_確認用");
    expect(JSON.stringify(await store.listEntries("灯台守外伝_確認用/設定/characters"))).toBe(before);
  });
});
