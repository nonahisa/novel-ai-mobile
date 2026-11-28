import { describe, expect, test } from "vitest";
import { MemoryFileStore } from "../src/platform/memoryFileStore";
import { readingSpansForEpisode } from "../src/platform/readingDictionary";
import { buildReadingPlan } from "../src/shared";

/**
 * 読みの辞書（本体の設計書 6.42.1。`.aiwriter/readings/<話>.json`）を読み上げに当てる。読むだけ。作品は作り物（`_確認用`）だけ
 */
const WORK = "灯台守_確認用";
const EPISODE = `${WORK}/本文/第1話 手紙.txt`;
const DICT = `${WORK}/.aiwriter/readings/本文__第1話 手紙.txt.json`;
const enc = (text: string) => new TextEncoder().encode(text);
const text = "灯台守は御伽噺を読んだ。";

function storeWith(json?: string): MemoryFileStore {
  const store = new MemoryFileStore();
  if (json !== undefined) store.putExternally(DICT, enc(json));
  return store;
}

const dictionary = (entries: unknown[]) => JSON.stringify({ version: 1, episode: "本文/第1話 手紙.txt", entries });

describe("読みの辞書を読み上げに当てる", () => {
  test("辞書の読みの範囲を返し、声へ渡す写しがその読みになる", async () => {
    const store = storeWith(dictionary([{ word: "御伽噺", quote: "御伽噺を読んだ", reading: "おとぎばなし", source: "ai" }]));
    const spans = await readingSpansForEpisode(store, WORK, EPISODE, text);
    expect(spans).toEqual([{ start: text.indexOf("御伽噺"), end: text.indexOf("御伽噺") + 3, reading: "おとぎばなし" }]);
    expect(buildReadingPlan(text, "site", spans)[0]!.speech).toContain("おとぎばなし");
  });

  test("作者の項目が AI の項目に勝ち、消した項目は当てない", async () => {
    const store = storeWith(
      dictionary([
        { word: "灯台守", quote: "灯台守は", reading: "とうだいまもり", source: "ai" },
        { word: "灯台守", quote: "灯台守は", reading: "とうだいもり", source: "author" },
        { word: "御伽噺", quote: "御伽噺を", reading: "おとぎばなし", source: "ai", removed: true },
      ])
    );
    expect(await readingSpansForEpisode(store, WORK, EPISODE, text)).toEqual([{ start: 0, end: 3, reading: "とうだいもり" }]);
  });

  test("辞書が無い・壊れている・形が違うときは空（読み上げは止めない。辞書には触らない）", async () => {
    expect(await readingSpansForEpisode(storeWith(), WORK, EPISODE, text)).toEqual([]);
    const broken = storeWith("{ こわれた");
    expect(await readingSpansForEpisode(broken, WORK, EPISODE, text)).toEqual([]);
    expect(new TextDecoder().decode(await broken.readFile(DICT))).toBe("{ こわれた");
    expect(await readingSpansForEpisode(storeWith(JSON.stringify({ version: 2, entries: [] })), WORK, EPISODE, text)).toEqual([]);
  });

  test("作品の外の話は空", async () => {
    expect(await readingSpansForEpisode(storeWith(), WORK, "別の作品/本文/第1話.txt", text)).toEqual([]);
  });
});
