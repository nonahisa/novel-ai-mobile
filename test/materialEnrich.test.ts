import { describe, expect, it } from "vitest";
import { emptyCharacter } from "novel-ai-assistant/src/models/character";
import { emptyLocation, parseLocation } from "novel-ai-assistant/src/models/location";
import { emptyAbility, parseAbility } from "novel-ai-assistant/src/models/ability";
import { emptyOrganization, parseOrganization } from "novel-ai-assistant/src/models/organization";
import { emptyWorldItem, parseWorldItem } from "novel-ai-assistant/src/models/world";
import { parseCharacter } from "novel-ai-assistant/src/models/character";
import { MemoryFileStore } from "../src/platform/memoryFileStore";
import { applyEnrichRows, prepareEnrich, readRecordFile, runEnrich, saveRecord, type EnrichKind } from "../src/platform/materialEnrich";
import { renderEnrichOutcome } from "../src/app/materialEnrichScreen";
import type { ModelCall } from "../src/platform/typoCheck";
import { readWorkLayout, scanWorkFolder } from "../src/platform/workScan";

/**
 * 設定資料の1件を本文から読み直す（本体の［AIで再読込］と同じ部品。2026-11-22）。AI は作り物（本物の有料の AI は呼ばない）。
 * 作品は作り物（`_確認用`）だけ
 */
const enc = (text: string) => new TextEncoder().encode(text);
const dec = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
const ROOT = "灯台守_確認用";
const SET = `${ROOT}/設定`;
const SISTER = `${SET}/characters/char_001.json`;

function storeWith(extra: Record<string, string> = {}): MemoryFileStore {
  const store = new MemoryFileStore();
  const files: Record<string, string> = {
    [`${ROOT}/.aiwriter/config.json`]: JSON.stringify({ workTitle: "灯台守の手紙_確認用" }),
    [`${ROOT}/本文/第1話 手紙.txt`]: "姉から手紙が届いた。\n「わたしは元気よ」と姉は書いていた。灯は無口な少年だ。\n",
    [`${ROOT}/本文/第2話 霧笛.txt`]: "霧が出た。姉は灯台の上で霧笛を鳴らした。\n",
    [SISTER]: `${JSON.stringify({ ...emptyCharacter("char_001", "姉"), summary: "灯台に住む姉" }, null, 2)}\n`,
    [`${SET}/locations/loc_001.json`]: `${JSON.stringify(emptyLocation("loc_001", "灯台"), null, 2)}\n`,
    ...extra,
  };
  for (const [path, text] of Object.entries(files)) store.putExternally(path, enc(text));
  return store;
}

async function prepare(store: MemoryFileStore, kind: "character" | "location", id: string, notes = "", undecided?: Set<string>) {
  const [work, layout] = await Promise.all([scanWorkFolder(store, ROOT), readWorkLayout(store, ROOT)]);
  return prepareEnrich({ store, work, settingsDir: layout.settings, memoMarkers: layout.memoMarkers, kind, id, notes, ...(undecided ? { undecidedConflicts: undecided } : {}) });
}

/** 作り物の AI：頼まれた文を控え、決めた答えを返す */
function fakeAi(answer: Record<string, unknown>): { call: ModelCall; seen: { system: string; user: string; schema: unknown; temperature?: number }[] } {
  const seen: { system: string; user: string; schema: unknown; temperature?: number }[] = [];
  const call: ModelCall = async (request) => {
    seen.push({ system: request.system, user: request.user, schema: request.schema, ...(request.temperature !== undefined ? { temperature: request.temperature } : {}) });
    return JSON.stringify(answer);
  };
  return { call, seen };
}

const characterAnswer = (values: Record<string, string | null>) => ({
  gender: null,
  summary: null,
  affiliation: null,
  role: null,
  personality: null,
  speechStyle: null,
  appearance: null,
  misattributed: [],
  ...values,
});

describe("設定資料の1件を本文から読み直す", () => {
  it("名前の出る場面を本文から抜いて、本体の頼みの文・答えの形・揺らしで頼む。【現在の設定】に今の紹介が入る", async () => {
    const store = storeWith();
    const material = await prepare(store, "character", "char_001");
    expect(material.excerpts.map((excerpt) => excerpt.label)).toEqual(["第1話 手紙", "第2話 霧笛"]);
    expect(material.excerptChars).toBeGreaterThan(0);
    expect(material.prompt).toContain("姉から手紙が届いた");
    expect(material.prompt).toContain("灯台に住む姉");
    const { call, seen } = fakeAi(characterAnswer({ personality: "面倒見がよい" }));
    await runEnrich(material, call);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.user).toBe(material.prompt);
    expect(seen[0]!.temperature).toBe(0.3);
    expect(JSON.stringify(seen[0]!.schema)).toContain("misattributed");
  });

  it("競合の印のある話・選んでいない話の本文は渡さない", async () => {
    const store = storeWith({ [`${ROOT}/本文/第2話 霧笛.txt`]: "<<<<<<< ours\n姉は灯台にいた。\n=======\n姉は海にいた。\n>>>>>>> theirs\n" });
    expect((await prepare(store, "character", "char_001")).excerpts.map((e) => e.label)).toEqual(["第1話 手紙"]);
    const clean = storeWith();
    const material = await prepare(clean, "character", "char_001", "", new Set([`${ROOT}/本文/第1話 手紙.txt`]));
    expect(material.excerpts.map((e) => e.label)).toEqual(["第2話 霧笛"]);
  });

  it("答えを検算して案にする：空欄を埋める案は選ぶ前提・今と同じ値は出さない・作品に無い話を挙げた案は外して訳を残す。書かない", async () => {
    const store = storeWith();
    const before = dec(await store.readFile(SISTER));
    const material = await prepare(store, "character", "char_001");
    const { call } = fakeAi(characterAnswer({ summary: "灯台に住む姉", personality: "面倒見がよい", role: "第9話で灯台守になる" }));
    const outcome = await runEnrich(material, call);
    expect(outcome.rows).toEqual([{ key: "personality", label: expect.any(String), before: "", after: "面倒見がよい", fillsBlank: true, multiline: expect.any(Boolean) }]);
    expect(outcome.dropped.join("\n")).toContain("第9");
    expect(dec(await store.readFile(SISTER))).toBe(before);
  });

  it("作者の資料（autoGenerated: false）の書かれた欄には案を出さない（空欄を埋める案は出す）", async () => {
    const store = storeWith({ [SISTER]: `${JSON.stringify({ ...emptyCharacter("char_001", "姉"), summary: "灯台に住む姉", autoGenerated: false }, null, 2)}\n` });
    const material = await prepare(store, "character", "char_001");
    const { call } = fakeAi(characterAnswer({ summary: "霧笛を鳴らす姉", personality: "面倒見がよい" }));
    const outcome = await runEnrich(material, call);
    expect(outcome.rows.map((row) => row.key)).toEqual(["personality"]);
    expect(outcome.heldBack).toEqual([{ label: expect.any(String), after: "霧笛を鳴らす姉" }]);
    // パソコンの画面と同じ出し方にしたとき（作者の答えで替えられる）
    const loose = await runEnrich(material, call, { protectAuthorValues: false });
    expect(loose.rows.find((row) => row.key === "summary")).toMatchObject({ before: "灯台に住む姉", after: "霧笛を鳴らす姉", fillsBlank: false });
  });

  it("選んだ案を当てて書き戻す：本体と同じ形（2字下げ・末に改行・updatedAt）。元の改行（CRLF）のまま。作者の印は付けない。元は退避する", async () => {
    const crlf = `${JSON.stringify({ ...emptyCharacter("char_001", "姉"), summary: "灯台に住む姉" }, null, 2)}\n`.replace(/\n/g, "\r\n");
    const store = storeWith({ [SISTER]: crlf });
    const target = (await readRecordFile(store, SET, "character", "char_001"))!;
    const updated = applyEnrichRows(target, { personality: "面倒見がよい" }, [], "2026-11-22T00:00:00.000Z");
    const saved = await saveRecord(store, target, updated, "2026-11-22T00:00:00.000Z");
    expect(saved.ok).toBe(true);
    const text = dec(await store.readFile(SISTER));
    expect(text.includes("\r\n")).toBe(true);
    const json = JSON.parse(text);
    expect(json.personality).toBe("面倒見がよい");
    expect(json.summary).toBe("灯台に住む姉");
    expect(json.autoGenerated).toBe(true);
    expect(json.updatedAt).toBe("2026-11-22T00:00:00.000Z");
    expect(text).toBe(`${JSON.stringify(json, null, 2)}\n`.replace(/\n/g, "\r\n"));
    if (saved.ok) expect(saved.recoveryPath).toBeDefined();
  });

  it("書く前に外で変わっていたら書かない。新しい形の資料は書かない。知らない欄は残す", async () => {
    const store = storeWith();
    const target = (await readRecordFile(store, SET, "character", "char_001"))!;
    store.putExternally(SISTER, enc(`${JSON.stringify({ ...emptyCharacter("char_001", "姉"), summary: "外で直した" }, null, 2)}\n`));
    const updated = applyEnrichRows(target, { personality: "面倒見がよい" }, [], "2026-11-22T00:00:00.000Z");
    expect(await saveRecord(store, target, updated, "2026-11-22T00:00:00.000Z")).toMatchObject({ ok: false, reason: "modified_externally" });
    expect(JSON.parse(dec(await store.readFile(SISTER))).summary).toBe("外で直した");

    const unknown = storeWith({ [SISTER]: `${JSON.stringify({ ...emptyCharacter("char_001", "姉"), futureField: "パソコンの新しい欄" }, null, 2)}\n` });
    const withUnknown = (await readRecordFile(unknown, SET, "character", "char_001"))!;
    // パソコンの新しい版で足された欄は、本体の読み方が残すので、書き戻しても消えない
    expect(await saveRecord(unknown, withUnknown, applyEnrichRows(withUnknown, { personality: "x" }, [], "t"), "t")).toMatchObject({ ok: true });
    expect(JSON.parse(dec(await unknown.readFile(SISTER))).futureField).toBe("パソコンの新しい欄");

    const newer = storeWith({ [SISTER]: `${JSON.stringify({ ...emptyCharacter("char_001", "姉"), schemaVersion: "9.0" }, null, 2)}\n` });
    const withNewer = (await readRecordFile(newer, SET, "character", "char_001"))!;
    expect(await saveRecord(newer, withNewer, applyEnrichRows(withNewer, { personality: "x" }, [], "t"), "t")).toMatchObject({ ok: false, reason: "newer_shape" });
  });

  it("はじいた記述（この資料のものではない）は、本文と照合できたものだけ、本体の項目の見出しで見せる。案にしなかったもの・検算で外した案も画面に出る", async () => {
    const store = storeWith({ [SISTER]: `${JSON.stringify({ ...emptyCharacter("char_001", "姉"), summary: "灯台に住む姉", autoGenerated: false }, null, 2)}
` });
    const material = await prepare(store, "character", "char_001");
    const { call } = fakeAi(
      characterAnswer({
        summary: "霧笛を鳴らす姉",
        role: "第9話で灯台守になる",
        misattributed: [
          { belongsTo: "灯", field: "personality", value: "無口", evidence: "灯は無口な少年だ" },
          { belongsTo: "灯", field: "personality", value: "陽気", evidence: "本文に無い文" },
        ],
      })
    );
    const outcome = await runEnrich(material, call);
    expect(outcome.misattributed).toEqual([{ belongsTo: "灯", field: "personality", value: "無口", evidence: "灯は無口な少年だ", fieldLabel: "性格" }]);
    const html = renderEnrichOutcome(outcome);
    expect(html).toContain("灯</b>の性格：無口");
    expect(html).not.toContain("personality");
    expect(html).toContain("案にしなかったもの");
    expect(html).toContain("霧笛を鳴らす姉");
    expect(html).toContain("検算で外した案");
  });

  it("5種類とも、1項目を反映して書き戻しても、ほかの欄・欄の並び・知らない欄は変わらない（変わるのはその項目と updatedAt だけ）", async () => {
    const cases: { kind: EnrichKind; dir: string; id: string; record: Record<string, unknown>; parse: (raw: unknown) => object; edit: Record<string, string> }[] = [
      {
        kind: "character",
        dir: "characters",
        id: "char_001",
        record: { ...emptyCharacter("char_001", "姉"), aliases: ["ねえさん"], summary: "灯台に住む姉", relations: [{ name: "灯", relation: "弟" }], appearedChapters: [1, 2], authorNotes: "妹には甘い", customFields: { birthday: "三月三日" } },
        parse: parseCharacter,
        edit: { personality: "面倒見がよい" },
      },
      { kind: "ability", dir: "abilities", id: "abil_001", record: { ...emptyAbility("abil_001", "灯火"), summary: "火を灯す", aliases: ["ともしび"] }, parse: parseAbility, edit: { limitation: "雨の日は使えない" } },
      { kind: "organization", dir: "organizations", id: "org_001", record: { ...emptyOrganization("org_001", "灯台守の会"), summary: "灯台を守る" }, parse: parseOrganization, edit: { description: "岬の灯台を交代で守る" } },
      { kind: "location", dir: "locations", id: "loc_001", record: { ...emptyLocation("loc_001", "灯台"), summary: "岬の灯台", appearedChapters: [1] }, parse: parseLocation, edit: { region: "北の岬" } },
      { kind: "world", dir: "world", id: "world_001", record: { ...emptyWorldItem("world_001", "霧笛の決まり", "rule"), description: "霧の夜は三度鳴らす" }, parse: parseWorldItem, edit: { description: "霧の夜は五度鳴らす" } },
    ];
    for (const item of cases) {
      // 本体が書いた形（本体の読み方を通した中身を2字下げ）に、パソコンの新しい版の欄を1つ足す
      const original = { ...(item.parse(JSON.parse(JSON.stringify(item.record))) as Record<string, unknown>), futureField: "パソコンの新しい欄" };
      const path = `${SET}/${item.dir}/${item.id}.json`;
      const store = new MemoryFileStore();
      store.putExternally(path, enc(`${JSON.stringify(original, null, 2)}
`));
      const target = (await readRecordFile(store, SET, item.kind, item.id))!;
      const saved = await saveRecord(store, target, applyEnrichRows(target, item.edit, [], "2026-11-22T00:00:00.000Z"), "2026-11-22T00:00:00.000Z");
      expect(saved, item.kind).toMatchObject({ ok: true });
      const written = JSON.parse(dec(await store.readFile(path))) as Record<string, unknown>;
      expect(Object.keys(written), item.kind).toEqual(Object.keys(original));
      const changed = Object.keys(original).filter((key) => JSON.stringify(original[key]) !== JSON.stringify(written[key]));
      expect(changed.sort(), item.kind).toEqual([...Object.keys(item.edit), "updatedAt"].sort());
      expect(written.futureField, item.kind).toBe("パソコンの新しい欄");
    }
  });

  it("道の id から置き場の道を作らない（知らない id・../ は見つからない）", async () => {
    const store = storeWith();
    expect(await readRecordFile(store, SET, "character", "../locations/loc_001")).toBeUndefined();
    expect(await readRecordFile(store, SET, "character", "char_999")).toBeUndefined();
    await expect(prepare(store, "character", "char_999")).rejects.toThrow("見つかりません");
  });

  it("場所も読み直せる（種類ごとの本体の項目）", async () => {
    const store = storeWith();
    const material = await prepare(store, "location", "loc_001");
    const { call } = fakeAi({ summary: "岬の灯台", region: null, description: null, misattributed: [] });
    const outcome = await runEnrich(material, call);
    expect(outcome.rows.map((row) => [row.key, row.after])).toEqual([["summary", "岬の灯台"]]);
  });
});
