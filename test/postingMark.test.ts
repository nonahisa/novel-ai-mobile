import { describe, expect, it } from "vitest";
import { MemoryFileStore } from "../src/platform/memoryFileStore";
import { markPosted, mergePostingLedgerTexts, readPostingMark } from "../src/platform/postingMark";
import { postingNotationTextHash, postingTitleHash } from "../src/shared";

/**
 * ［…］→［投稿しました］：投稿の台帳（`設定/投稿状態.json`）へ「投稿しました」の印を付ける（2026-11-28 作者の答え
 * 「付ける（ぶつかったら両方の印を残す）」。本体の `postingKit.ts` の `withPost` と同じ記録）。作品は作り物（`_確認用`）だけ
 */
const enc = (text: string) => new TextEncoder().encode(text);
const dec = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
const ROOT = "灯台守_確認用";
const LEDGER = `${ROOT}/設定/投稿状態.json`;
const EP1 = `${ROOT}/本文/第1話 手紙.txt`;
const BODY1 = "姉から手紙が届いた。\n// 付箋：ここは後で直す\nあいうえお\n";
const KAKUYOMU = { site: "kakuyomu", newEpisodeUrl: "https://kakuyomu.jp/my/works/1177354054/episodes/new" };
const NAROU = { site: "narou", newEpisodeUrl: "https://syosetu.com/usernovelmanage/ziwaiinput/ncode/123/" };

async function storeWith(ledger?: string, episodes: Record<string, string> = { [EP1]: BODY1 }): Promise<MemoryFileStore> {
  const store = new MemoryFileStore();
  store.putExternally(`${ROOT}/.aiwriter/config.json`, enc(JSON.stringify({ workTitle: "灯台守の手紙_確認用" })));
  for (const [path, text] of Object.entries(episodes)) store.putExternally(path, enc(text));
  if (ledger !== undefined) store.putExternally(LEDGER, enc(ledger));
  return store;
}

const ledgerOf = (value: Record<string, unknown>) => `${JSON.stringify({ schemaVersion: "1", sites: [KAKUYOMU, NAROU], posts: [], rankings: [], ...value }, null, 2)}\n`;
const readLedger = async (store: MemoryFileStore) => JSON.parse(dec(await store.readFile(LEDGER))) as Record<string, unknown>;
const NOW = new Date("2026-11-28T00:30:00+09:00");

describe("台帳から、この話をどのサイトへ出したかを読む", () => {
  it("台帳が無い・投稿先が登録されていなければ、印は出さない（台帳も作らない）", async () => {
    expect(await readPostingMark(await storeWith(), ROOT, EP1)).toEqual({ kind: "none" });
    expect(await readPostingMark(await storeWith(ledgerOf({ sites: [] })), ROOT, EP1)).toEqual({ kind: "none" });
  });

  it("登録したサイトごとに、この話を出したかを返す", async () => {
    const store = await storeWith(ledgerOf({ posts: [{ episodePath: "本文/第1話 手紙.txt", site: "narou", postedAt: "2026-11-01T00:00:00.000Z" }] }));
    expect(await readPostingMark(store, ROOT, EP1)).toEqual({
      kind: "ready",
      sites: [
        { site: "kakuyomu", posted: false },
        { site: "narou", posted: true },
      ],
    });
  });

  it("壊れた台帳・この版の知らない新しい形の台帳では、印を付けない", async () => {
    expect((await readPostingMark(await storeWith("{ 壊れた"), ROOT, EP1)).kind).toBe("blocked");
    expect((await readPostingMark(await storeWith(ledgerOf({ schemaVersion: "99" })), ROOT, EP1)).kind).toBe("blocked");
  });

  it("合本（1ファイルに何話も）には印を出さず、付けもしない（ファイルまるごとの印は全話を投稿済みにしてしまう）", async () => {
    // 本体の合本の試し（collectedNavigation.test.ts）と同じ区切り
    const collected = ["----- エピソード1開始 -----", "【本文】", "　一話目", "----- エピソード2開始 -----", "【本文】", "　二話目"].join("\n");
    const path = `${ROOT}/本文/合本.txt`;
    const text = ledgerOf({});
    const store = await storeWith(text, { [path]: collected });
    expect((await readPostingMark(store, ROOT, path)).kind).toBe("blocked");
    expect((await markPosted({ store, workRoot: ROOT, episodePath: path, site: "kakuyomu", now: NOW })).ok).toBe(false);
    expect(dec(await store.readFile(LEDGER))).toBe(text);
  });

  it("競合の印（<<<<<<<）が残っている話には印を付けない", async () => {
    const store = await storeWith(ledgerOf({}), { [EP1]: "<<<<<<< こちら\nあ\n=======\nい\n>>>>>>> あちら\n" });
    expect((await readPostingMark(store, ROOT, EP1)).kind).toBe("blocked");
  });
});

describe("［投稿しました］で印を付ける", () => {
  it("本体と同じ記録（道・サイト・日時・本文の印・題の印）を posts に足し、ほかの欄は1字も変えない", async () => {
    const original = {
      schemaVersion: "1",
      sites: [KAKUYOMU, NAROU],
      siteProfiles: [{ site: "kakuyomu", workId: "1177354054" }],
      posts: [{ episodePath: "本文/第2話 霧笛.txt", site: "kakuyomu", postedAt: "2026-11-01T00:00:00.000Z", siteEpisodeId: "99" }],
      rankings: [],
      readerStats: [{ site: "kakuyomu", unknownMetric: 1 }],
      futureField: { keep: "そのまま" },
    };
    const store = await storeWith(`${JSON.stringify(original, null, 2)}\n`);
    const touched: string[] = [];
    const result = await markPosted({ store, workRoot: ROOT, episodePath: EP1, site: "kakuyomu", now: NOW, beforeWrite: async (path) => void touched.push(path) });
    expect(result.ok).toBe(true);
    expect(touched).toEqual([LEDGER]);
    const after = await readLedger(store);
    expect({ ...after, posts: undefined }).toEqual({ ...original, posts: undefined });
    expect(after.posts).toEqual([
      original.posts[0],
      {
        episodePath: "本文/第1話 手紙.txt",
        site: "kakuyomu",
        postedAt: NOW.toISOString(),
        bodyHash: postingNotationTextHash("手紙", BODY1),
        titleHash: postingTitleHash("手紙"),
      },
    ]);
    // 2字下げの書き方のまま
    expect(dec(await store.readFile(LEDGER))).toContain('\n  "sites": [');
  });

  it("もうそのサイトへ出した話・登録していないサイトには、印を付けない（台帳は変えない）", async () => {
    const text = ledgerOf({ posts: [{ episodePath: "本文/第1話 手紙.txt", site: "kakuyomu", postedAt: "2026-11-01T00:00:00.000Z" }] });
    const store = await storeWith(text);
    expect((await markPosted({ store, workRoot: ROOT, episodePath: EP1, site: "kakuyomu", now: NOW })).ok).toBe(false);
    expect((await markPosted({ store, workRoot: ROOT, episodePath: EP1, site: "alphapolis", now: NOW })).ok).toBe(false);
    expect(dec(await store.readFile(LEDGER))).toBe(text);
  });

  it("壊れた台帳は直さずに止める", async () => {
    const store = await storeWith("{ 壊れた");
    expect((await markPosted({ store, workRoot: ROOT, episodePath: EP1, site: "kakuyomu", now: NOW })).ok).toBe(false);
    expect(dec(await store.readFile(LEDGER))).toBe("{ 壊れた");
  });

  it("読んだあとで台帳が書き換わっていたら、上書きしない（同期や別の道が先に書いた）", async () => {
    const store = await storeWith(ledgerOf({}));
    const meanwhile = ledgerOf({ posts: [{ episodePath: "本文/第3話.txt", site: "narou", postedAt: "2026-11-27T00:00:00.000Z" }] });
    const result = await markPosted({
      store,
      workRoot: ROOT,
      episodePath: EP1,
      site: "kakuyomu",
      now: NOW,
      beforeWrite: async () => store.putExternally(LEDGER, enc(meanwhile)),
    });
    expect(result.ok).toBe(false);
    expect(dec(await store.readFile(LEDGER))).toBe(meanwhile);
  });
});

describe("同期でぶつかった台帳は、両方の印を残して合わせる", () => {
  const post = (episodePath: string, site: string, postedAt: string, extra: Record<string, unknown> = {}) => ({ episodePath, site, postedAt, ...extra });
  const base = ledgerOf({ posts: [post("本文/第1話.txt", "kakuyomu", "2026-11-01T00:00:00.000Z")] });

  it("こちらが印を足しただけなら、あちらの台帳にこちらの印を足す（あちらの直しも印も消さない）", () => {
    const ours = ledgerOf({ posts: [post("本文/第1話.txt", "kakuyomu", "2026-11-01T00:00:00.000Z"), post("本文/第2話.txt", "kakuyomu", "2026-11-28T00:00:00.000Z")] });
    const theirs = ledgerOf({
      posts: [post("本文/第1話.txt", "kakuyomu", "2026-11-01T00:00:00.000Z", { siteEpisodeId: "11" }), post("本文/第2話.txt", "narou", "2026-11-27T00:00:00.000Z")],
      futureField: "あちらで足した",
    });
    const merged = JSON.parse(mergePostingLedgerTexts(base, ours, theirs)!) as { posts: unknown[]; futureField: unknown };
    expect(merged.posts).toEqual([
      post("本文/第1話.txt", "kakuyomu", "2026-11-01T00:00:00.000Z", { siteEpisodeId: "11" }),
      post("本文/第2話.txt", "narou", "2026-11-27T00:00:00.000Z"),
      post("本文/第2話.txt", "kakuyomu", "2026-11-28T00:00:00.000Z"),
    ]);
    expect(merged.futureField).toBe("あちらで足した");
  });

  it("同じ話・同じサイトの印が両方にあれば、あちらの1件を残す（本体の withPost と同じく1件に保つ）", () => {
    const ours = ledgerOf({ posts: [post("本文/第1話.txt", "kakuyomu", "2026-11-01T00:00:00.000Z"), post("本文/第2話.txt", "kakuyomu", "2026-11-28T00:00:00.000Z")] });
    const theirs = ledgerOf({ posts: [post("本文/第1話.txt", "kakuyomu", "2026-11-01T00:00:00.000Z"), post("本文/第2話.txt", "kakuyomu", "2026-11-27T22:00:00.000Z", { postRef: "r1" })] });
    const merged = JSON.parse(mergePostingLedgerTexts(base, ours, theirs)!) as { posts: unknown[] };
    expect(merged.posts).toEqual([post("本文/第1話.txt", "kakuyomu", "2026-11-01T00:00:00.000Z"), post("本文/第2話.txt", "kakuyomu", "2026-11-27T22:00:00.000Z", { postRef: "r1" })]);
  });

  it("こちらが印のほかも変えていたら、合わせない（いつもの［こちら］［あちら］で選ぶ）", () => {
    const ours = ledgerOf({ posts: [post("本文/第1話.txt", "kakuyomu", "2026-11-01T00:00:00.000Z")], sites: [KAKUYOMU] });
    const theirs = ledgerOf({ posts: [post("本文/第1話.txt", "kakuyomu", "2026-11-01T00:00:00.000Z"), post("本文/第3話.txt", "narou", "2026-11-27T00:00:00.000Z")] });
    expect(mergePostingLedgerTexts(base, ours, theirs)).toBeUndefined();
  });

  it("こちらが前からある印を消した・書き換えた（話の名前替えなど）ときも、合わせない", () => {
    const ours = ledgerOf({ posts: [post("本文/第1話_手紙.txt", "kakuyomu", "2026-11-01T00:00:00.000Z")] });
    const theirs = ledgerOf({ posts: [post("本文/第1話.txt", "kakuyomu", "2026-11-01T00:00:00.000Z"), post("本文/第3話.txt", "narou", "2026-11-27T00:00:00.000Z")] });
    expect(mergePostingLedgerTexts(base, ours, theirs)).toBeUndefined();
  });

  it("どれか1つでも壊れていれば合わせない", () => {
    const ours = ledgerOf({ posts: [post("本文/第1話.txt", "kakuyomu", "2026-11-01T00:00:00.000Z"), post("本文/第2話.txt", "kakuyomu", "2026-11-28T00:00:00.000Z")] });
    expect(mergePostingLedgerTexts(base, ours, "{ 壊れた")).toBeUndefined();
    expect(mergePostingLedgerTexts("{ 壊れた", ours, base)).toBeUndefined();
  });
});
