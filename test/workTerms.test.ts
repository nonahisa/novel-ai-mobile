import { describe, expect, it } from "vitest";
import { emptyCharacter } from "novel-ai-assistant/src/models/character";
import { emptyLocation } from "novel-ai-assistant/src/models/location";
import { emptyAbility } from "novel-ai-assistant/src/models/ability";
import { emptyOrganization } from "novel-ai-assistant/src/models/organization";
import { MemoryFileStore } from "../src/platform/memoryFileStore";
import { readWorkTerms } from "../src/platform/workTerms";

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
