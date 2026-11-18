import { describe, expect, test } from "vitest";
import { DEFAULT_MEMO_MARKERS, PROOFREAD_TEMPERATURE } from "../src/shared";
import { MemoryFileStore } from "../src/platform/memoryFileStore";
import { checkEpisodeProofread, readKeepWords } from "../src/platform/proofreadCheck";
import type { ModelCall } from "../src/platform/typoCheck";

/** 推敲（段2。2026-11-18）。本物の AI は呼ばない。頼み方・確かめ・行の戻し方を偽の AI で見張る */
const NO_MARKERS = { memoMarkers: DEFAULT_MEMO_MARKERS };
const TEXT = ["朝の灯台は静かだった。", "姉はとても本当にとても嬉しかった。", "霧が出た。"].join("\n");
const issue = (over: Record<string, unknown> = {}) => ({
  line: 2,
  original: "姉はとても本当にとても嬉しかった。",
  target: "姉はとても本当にとても嬉しかった。",
  suggestion: "姉は本当に嬉しかった。",
  reason: "冗長",
  explanation: "「とても」が2回重なり、強調が薄れる",
  confidence: "high",
  ...over,
});
const answering = (issues: unknown[], seen: Parameters<ModelCall>[0][] = []): ModelCall => async (request) => {
  seen.push(request);
  return JSON.stringify({ issues });
};

describe("推敲", () => {
  test("本文と合う指摘を、元の行・観点・説明つきで返す。揺らしは本体の推敲の値で頼む", async () => {
    const seen: Parameters<ModelCall>[0][] = [];
    const result = await checkEpisodeProofread({ path: "作品/本文/第1話.txt", text: TEXT, keepWords: [], ...NO_MARKERS }, answering([issue()], seen));
    expect(result.failures).toEqual([]);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({ path: "作品/本文/第1話.txt", line: 2, reason: "冗長", suggestion: "姉は本当に嬉しかった。" });
    expect(result.findings[0]!.explanation).toContain("とても");
    expect(seen[0]!.temperature).toBe(PROOFREAD_TEMPERATURE);
    expect(seen[0]!.user).toContain("2: 姉はとても本当にとても嬉しかった。");
  });
  test("本文に無い原文の指摘は捨てる（AI の答えを信用しない）", async () => {
    const result = await checkEpisodeProofread({ path: "p", text: TEXT, keepWords: [], ...NO_MARKERS }, answering([issue({ original: "本文に無い文。", target: "本文に無い文。" })]));
    expect(result.findings).toHaveLength(0);
    expect(result.rejected).toBe(1);
  });
  test("作者が直さないと決めた語を含む指摘は出さない", async () => {
    const keep = [{ word: "とても本当に", note: "", addedAt: "2026-11-18" }];
    const result = await checkEpisodeProofread({ path: "p", text: TEXT, keepWords: keep, ...NO_MARKERS }, answering([issue()]));
    expect(result.findings).toHaveLength(0);
  });
  test("読めない答え・失敗は区切りごとの失敗にする（0件にしない）", async () => {
    const broken: ModelCall = async () => "読めない";
    expect((await checkEpisodeProofread({ path: "p", text: TEXT, keepWords: [], ...NO_MARKERS }, broken)).failures).toHaveLength(1);
    const failing: ModelCall = async () => {
      throw new Error("AI の答えが途中で切れました");
    };
    expect((await checkEpisodeProofread({ path: "p", text: TEXT, keepWords: [], ...NO_MARKERS }, failing)).failures[0]!.reason).toContain("途中で切れました");
  });
});

describe("直さない語", () => {
  test("設定の keep_words.json を読む。無い・壊れていれば空", async () => {
    const store = new MemoryFileStore();
    expect(await readKeepWords(store, "作品/設定")).toEqual([]);
    store.putExternally("作品/設定/keep_words.json", new TextEncoder().encode(JSON.stringify({ schemaVersion: 1, words: [{ word: "灯台守", note: "", addedAt: "2026-11-18" }] })));
    expect((await readKeepWords(store, "作品/設定")).map((w) => w.word)).toEqual(["灯台守"]);
    store.putExternally("作品/設定/keep_words.json", new TextEncoder().encode("{壊れ"));
    expect(await readKeepWords(store, "作品/設定")).toEqual([]);
  });
});
