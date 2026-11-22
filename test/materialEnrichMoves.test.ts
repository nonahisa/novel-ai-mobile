import { describe, expect, it } from "vitest";
import { emptyCharacter, type Character } from "novel-ai-assistant/src/models/character";
import { MemoryFileStore } from "../src/platform/memoryFileStore";
import { applyEnrich, prepareEnrich, runEnrich } from "../src/platform/materialEnrich";
import { renderEnrichOutcome } from "../src/app/materialEnrichScreen";
import type { ModelCall } from "../src/platform/typoCheck";
import { readWorkLayout, scanWorkFolder } from "../src/platform/workScan";

/**
 * 本文から読み直すで、語り手の取り違えで主人公の資料に入った値を、本来の人物の資料へ移す案
 * （本体の［AIで再読込］と同じ部品。設計書6.5.12。本体 v1.0.44 で core へ移った）。
 * AI は作り物、作品は作り物（`_確認用`）だけ
 */
const enc = (text: string) => new TextEncoder().encode(text);
const dec = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
const ROOT = "皇宮_確認用";
const SET = `${ROOT}/設定`;
const PENDING = `${ROOT}/.aiwriter/pending-characters`;
const HERO = `${SET}/characters/char_007.json`;
const PRINCE = `${SET}/characters/char_016.json`;
const EMPEROR = `${SET}/characters/char_012.json`;
const NOW = "2026-11-22T12:00:00.000Z";

const HERO_SCENE =
  "　俺は串焼きを頬張った。旨い。\n" +
  "　俺はもう一本頼むことにした。俺は腹が減っていた。\n" +
  "「おかわりだ」\n" +
  "　俺は店主に銀貨を渡した。俺は満足だった。\n" +
  "　俺は宿へ戻った。俺は剣を磨いた。俺は早く寝た。\n";
const PRINCE_SCENE =
  "　広い部屋にポツンと置かれた机で、余は先生の話をただ聞いていた。\n" +
  "「これは経済の基本です。殿下、聞いていますか」\n" +
  "　余もいつか、この退屈な皇宮から出ることができるのだろうか。\n";
const EMPEROR_SCENE =
  "「陛下、ご報告に参りました」\n" +
  "　執務室で若い皇帝に声をかけたのは、宰相の側近だった。\n" +
  "「はい、皇子殿下は、どの教科も優秀でございます」\n";

function change(field: string, value: string, chapters: number[]) {
  return { field, value, chapters, timepointId: null, note: null, evidence: null, source: "extracted" as const };
}

function hero(): Character {
  return {
    ...emptyCharacter("char_007", "アジャーノ"),
    role: "冒険者",
    firstPerson: { default: "俺", variants: [{ form: "余", context: null, chapters: [12], evidence: null }] },
    changes: [change("role", "冒険者", [10]), change("role", "皇子", [12])],
    appearedChapters: [10, 12],
  };
}

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

function storeWith(extra: Record<string, string> = {}): MemoryFileStore {
  const store = new MemoryFileStore();
  const files: Record<string, string> = {
    [`${ROOT}/.aiwriter/config.json`]: JSON.stringify({ workTitle: "皇宮_確認用" }),
    [`${ROOT}/本文/第10話 串焼き.txt`]: HERO_SCENE,
    [`${ROOT}/本文/第11話 宿.txt`]: HERO_SCENE.repeat(5),
    [`${ROOT}/本文/第12話 皇宮.txt`]: `${PRINCE_SCENE}\n◇◆◇◆\n\n${EMPEROR_SCENE}`,
    [HERO]: json(hero()),
    [PRINCE]: json({ ...emptyCharacter("char_016", "殿下"), firstPerson: { default: "余", variants: [] } }),
    [EMPEROR]: json({ ...emptyCharacter("char_012", "皇帝"), aliases: ["陛下"], firstPerson: { default: "余", variants: [] } }),
    ...extra,
  };
  for (const [path, text] of Object.entries(files)) store.putExternally(path, enc(text));
  return store;
}

async function prepare(store: MemoryFileStore, id: string) {
  const [work, layout] = await Promise.all([scanWorkFolder(store, ROOT), readWorkLayout(store, ROOT)]);
  return prepareEnrich({ store, work, settingsDir: layout.settings, memoMarkers: layout.memoMarkers, kind: "character", id, notes: "" });
}

const nothing: ModelCall = async () =>
  JSON.stringify({ gender: null, summary: null, affiliation: null, role: null, personality: null, speechStyle: null, appearance: null, misattributed: [] });

const read = async (store: MemoryFileStore, path: string) => JSON.parse(dec(await store.readFile(path))) as Character;

async function moveOf(store: MemoryFileStore) {
  const material = await prepare(store, "char_007");
  const outcome = await runEnrich(material, nothing);
  return { material, outcome, roleIndex: outcome.moves.findIndex((item) => item.kind === "change" && item.value === "皇子") };
}

describe("語り手の取り違えを移す案（本文から読み直す）", () => {
  it("主人公の読み直しでは、AI の案が無くても移す案が出る。既定では選ばず、移し先は名指しできた人", async () => {
    const store = storeWith();
    const { outcome, roleIndex } = await moveOf(store);
    expect(outcome.rows).toEqual([]);
    expect(roleIndex).toBeGreaterThanOrEqual(0);
    expect(outcome.moves[roleIndex]!.destination.kind).toBe("named");
    const html = renderEnrichOutcome(outcome);
    // 案が移す案だけでも反映できる（「新しい案はありませんでした」にしない）
    expect(html).toContain('id="enrichApply"');
    expect(html).not.toContain("新しい案はありませんでした");
    const move = html.split('<div class="enrich-move"')[roleIndex + 1]!;
    expect(move).toContain('<input type="checkbox" class="enrich-move-check">');
    expect(move).toContain('<option value="char_016" selected>「殿下」へ移す</option>');
    expect(move).toContain('<option value="">外すだけ</option>');
    expect(move).toContain("役割「皇子」");
  });

  it("主人公でない人物の読み直しには出さない", async () => {
    const store = storeWith();
    const outcome = await runEnrich(await prepare(store, "char_016"), nothing);
    expect(outcome.moves).toEqual([]);
  });

  it("移し先を先に、主人公をあとに書く。主人公の値は残った話の値へ戻り、外した値は退けた記録に残る", async () => {
    const store = storeWith();
    const { material, outcome, roleIndex } = await moveOf(store);
    const order: string[] = [];
    const result = await applyEnrich(store, material, {
      root: ROOT,
      values: {},
      moves: outcome.moves,
      moveValues: { [`narratorMove:${roleIndex}`]: "char_016" },
      now: NOW,
      beforeWrite: async (path) => void order.push(path),
    });
    expect(result.ok).toBe(true);
    expect(result.notice).toContain("1 件を「殿下」の資料へ移しました。");
    expect(order).toEqual([PRINCE, HERO]);
    const after = await read(store, HERO);
    expect(after.role).toBe("冒険者");
    expect(after.changes.map((entry) => entry.value)).toEqual(["冒険者"]);
    expect(after.rejectedValues?.map((entry) => `${entry.field}:${entry.value}`)).toEqual(["role:皇子"]);
    expect((await read(store, PRINCE)).role).toBe("皇子");
  });

  it("移し先を選ばなければ外すだけ（ほかの人物の資料は書かない）", async () => {
    const store = storeWith();
    const { material, outcome, roleIndex } = await moveOf(store);
    const before = dec(await store.readFile(PRINCE));
    const result = await applyEnrich(store, material, { root: ROOT, values: {}, moves: outcome.moves, moveValues: { [`narratorMove:${roleIndex}`]: "" }, now: NOW });
    expect(result.ok).toBe(true);
    expect(result.notice).toContain("外すだけにしました");
    expect((await read(store, HERO)).role).toBe("冒険者");
    expect(dec(await store.readFile(PRINCE))).toBe(before);
  });

  it("候補に無い人物を移し先に返されても動かさない（何も選んでいない扱い）", async () => {
    const store = storeWith();
    const { material, outcome, roleIndex } = await moveOf(store);
    const heroBefore = dec(await store.readFile(HERO));
    const emperorBefore = dec(await store.readFile(EMPEROR));
    const result = await applyEnrich(store, material, { root: ROOT, values: {}, moves: outcome.moves, moveValues: { [`narratorMove:${roleIndex}`]: "char_012" }, now: NOW });
    expect(result.ok).toBe(false);
    expect(dec(await store.readFile(HERO))).toBe(heroBefore);
    expect(dec(await store.readFile(EMPEROR))).toBe(emperorBefore);
  });

  it("項目の案と移す案を一緒に反映しても、移した値は戻らない", async () => {
    const store = storeWith();
    const { material, outcome, roleIndex } = await moveOf(store);
    const result = await applyEnrich(store, material, {
      root: ROOT,
      values: { summary: "旅の冒険者" },
      moves: outcome.moves,
      moveValues: { [`narratorMove:${roleIndex}`]: "char_016" },
      now: NOW,
    });
    expect(result.ok).toBe(true);
    expect(result.notice).toContain("1 項目を反映しました。");
    const after = await read(store, HERO);
    expect(after.summary).toBe("旅の冒険者");
    expect(after.role).toBe("冒険者");
    expect(after.changes.some((entry) => entry.value === "皇子")).toBe(false);
  });

  it("移し先が書けなければ、主人公も承認待ちも触らない", async () => {
    const store = storeWith({ [`${PENDING}/char_007.json`]: json(hero()) });
    const { material, outcome, roleIndex } = await moveOf(store);
    // 読んだあとで、移し先がパソコンの新しい版の形に書き換わった
    store.putExternally(PRINCE, enc(json({ ...emptyCharacter("char_016", "殿下"), schemaVersion: "9.0" })));
    const heroBefore = dec(await store.readFile(HERO));
    const result = await applyEnrich(store, material, { root: ROOT, values: {}, moves: outcome.moves, moveValues: { [`narratorMove:${roleIndex}`]: "char_016" }, now: NOW });
    expect(result.ok).toBe(false);
    expect(result.notice).toContain("殿下");
    expect(dec(await store.readFile(HERO))).toBe(heroBefore);
    expect(await store.listFiles(PENDING)).toEqual(["char_007.json"]);
  });

  it("主人公と移し先の承認待ちの更新案を片づける（新しく作る案・ほかの人物の案は残す）", async () => {
    const store = storeWith({
      [`${PENDING}/char_007.json`]: json(hero()),
      [`${PENDING}/char_016.json`]: json({ source: "chat", character: emptyCharacter("char_016", "殿下") }),
      [`${PENDING}/char_012.json`]: json(emptyCharacter("char_012", "皇帝")),
      [`${PENDING}/new_侍従.json`]: json({ kind: "creation", character: emptyCharacter("char_000", "侍従") }),
    });
    const { material, outcome, roleIndex } = await moveOf(store);
    const touched: string[] = [];
    const result = await applyEnrich(store, material, {
      root: ROOT,
      values: {},
      moves: outcome.moves,
      moveValues: { [`narratorMove:${roleIndex}`]: "char_016" },
      now: NOW,
      beforeWrite: async (path) => void touched.push(path),
    });
    expect(result.ok).toBe(true);
    expect((await store.listFiles(PENDING)).sort()).toEqual(["char_012.json", "new_侍従.json"]);
    expect(result.notice).toContain("承認待ちの更新案を片づけました");
    expect(touched).toContain(`${PENDING}/char_007.json`);
  });

  it("パソコンの新しい版の欄は残したまま書く（移して空になった欄で断らない）", async () => {
    const store = storeWith({ [HERO]: json({ ...hero(), futureField: { keep: true } }) });
    const { material, outcome } = await moveOf(store);
    const variant = outcome.moves.findIndex((item) => item.kind === "firstPersonVariant");
    expect(variant).toBeGreaterThanOrEqual(0);
    const result = await applyEnrich(store, material, { root: ROOT, values: {}, moves: outcome.moves, moveValues: { [`narratorMove:${variant}`]: "char_016" }, now: NOW });
    expect(result.ok).toBe(true);
    const after = (await read(store, HERO)) as Character & { futureField?: unknown };
    expect(after.firstPerson.variants).toEqual([]);
    expect(after.futureField).toEqual({ keep: true });
  });
});
