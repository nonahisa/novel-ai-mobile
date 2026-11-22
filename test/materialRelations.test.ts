import { describe, expect, it } from "vitest";
import { emptyCharacter, type Character } from "novel-ai-assistant/src/models/character";
import { MemoryFileStore } from "../src/platform/memoryFileStore";
import { readMaterialRelations, relationsOf } from "../src/platform/materialRelations";
import { renderMaterialRelations } from "../src/app/materialsScreen";

/**
 * 設定資料の1件 → 関係を見る（本体の人物相関図の個人中心図と同じ材料。`buildRelationGraph`・`egoGraph`）。
 * 読むだけ。作品は作り物（`_確認用`）だけ
 */
const enc = (text: string) => new TextEncoder().encode(text);

function form(term: string, firstChapter: number | null) {
  return { term, category: "defaultSecondPerson" as const, context: null, firstChapter, lastChapter: null, status: "current" as const, evidence: null };
}

const SISTER: Character = {
  ...emptyCharacter("char_001", "姉"),
  relations: [{ name: "灯", relation: "弟", firstChapter: 1 }, { name: "港の守人", relation: "幼なじみ" }],
};
const LIGHT: Character = {
  ...emptyCharacter("char_002", "灯"),
  relations: [{ name: "姉", relation: "姉" }],
  addressTerms: [{ targetName: "姉", targetId: "char_001", authorLocked: false, forms: [form("姉さん", 2)] }],
};
const SAILOR: Character = { ...emptyCharacter("char_003", "船乗り"), relations: [{ name: "灯", relation: "友人" }] };

describe("関係を見る", () => {
  it("つながっている人を、中心から見た言葉と相手から見た言葉に分けて並べる（呼び方は『』、話数は分かるときだけ）", () => {
    const result = relationsOf([SISTER, LIGHT, SAILOR], "char_001")!;
    expect(result.name).toBe("姉");
    const light = result.rows.find((row) => row.name === "灯")!;
    expect(light).toMatchObject({ id: "char_002", provisional: false });
    expect(light.fromCenter).toEqual(["弟（第1話から）"]);
    expect(light.toCenter).toEqual(["姉", "『姉さん』（第2話から）"]);
    // 2人先（灯の友人の船乗り）は出さない（1件の画面なので、その人とじかにつながる人だけ）
    expect(result.rows.some((row) => row.name === "船乗り")).toBe(false);
  });

  it("資料に無い相手は黙って落とさず、その印を付けて並べる", () => {
    const result = relationsOf([SISTER, LIGHT], "char_001")!;
    const guard = result.rows.find((row) => row.name === "港の守人")!;
    expect(guard).toMatchObject({ provisional: true, missing: "資料に無い相手" });
    expect(guard.fromCenter).toEqual(["幼なじみ"]);
  });

  it("つながる人がいなければ空。資料に無い人物なら undefined", () => {
    expect(relationsOf([SAILOR, emptyCharacter("char_009", "旅人")], "char_009")!.rows).toEqual([]);
    expect(relationsOf([SAILOR], "char_404")).toBeUndefined();
  });

  it("画面：相手の名前はその人の1件へ（資料に無い相手は押せない）。書かない", async () => {
    const store = new MemoryFileStore();
    const ROOT = "灯台守_確認用";
    for (const person of [SISTER, LIGHT]) store.putExternally(`${ROOT}/設定/characters/${person.id}.json`, enc(JSON.stringify(person)));
    const result = (await readMaterialRelations(store, `${ROOT}/設定`, "char_001"))!;
    const html = renderMaterialRelations(ROOT, result);
    expect(html).toContain(`href="#/materials/${encodeURIComponent(ROOT)}/character/char_002"`);
    expect(html).toContain("姉から：弟（第1話から）");
    expect(html).toContain("灯から：姉・『姉さん』（第2話から）");
    expect(html).not.toContain("unresolved:");
    expect(html).toContain("資料に無い相手");
    expect(renderMaterialRelations(ROOT, { name: "旅人", rows: [] })).toContain("つながっている人は、まだ資料にありません");
  });
});
