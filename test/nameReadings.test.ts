import { describe, expect, test } from "vitest";
import { emptyCharacter } from "novel-ai-assistant/src/models/character";
import { emptyLocation } from "novel-ai-assistant/src/models/location";
import { MemoryFileStore } from "../src/platform/memoryFileStore";
import { nameReadingSpansForWork } from "../src/platform/nameReadings";

/**
 * 設定資料の名前の読み（本体の設計書 6.42.2）を読み上げに当てる。読むだけ。IME の読みの控えはパソコンごとで同期しないので使わない。
 * 作品は作り物（`_確認用`）だけ
 */
const SETTINGS = "灯台守_確認用/設定";
const enc = (text: string) => new TextEncoder().encode(text);

function character(id: string, name: string, extra: Record<string, unknown> = {}) {
  return JSON.stringify({ ...emptyCharacter(id, name), ...extra });
}

describe("設定資料の名前の読みを読み上げに当てる", () => {
  test("名前と別名の読みを本文の出現に当てる（漢字を含む2字以上だけ）", async () => {
    const store = new MemoryFileStore();
    store.putExternally(`${SETTINGS}/characters/char_001.json`, enc(character("char_001", "白樺灯", { aliases: ["灯台娘"], reading: "シラカバアカリ", aliasReadings: { 灯台娘: "とうだいむすめ" } })));
    store.putExternally(`${SETTINGS}/characters/char_002.json`, enc(character("char_002", "灯", { reading: "あかり" })));
    const text = "白樺灯は灯台娘と呼ばれた。灯がともる。";
    const spans = await nameReadingSpansForWork(store, SETTINGS, text);
    expect(spans).toEqual([
      { start: 0, end: 3, reading: "しらかばあかり" },
      { start: text.indexOf("灯台娘"), end: text.indexOf("灯台娘") + 3, reading: "とうだいむすめ" },
    ]);
  });

  test("資料が無い・壊れた1件は飛ばして、読めた分だけ当てる（資料には触らない）", async () => {
    const store = new MemoryFileStore();
    expect(await nameReadingSpansForWork(store, SETTINGS, "白樺灯")).toEqual([]);
    store.putExternally(`${SETTINGS}/characters/char_001.json`, enc("{ こわれた"));
    store.putExternally(`${SETTINGS}/locations/loc_001.json`, enc(JSON.stringify({ ...emptyLocation("loc_001", "北の岬"), reading: "きたのみさき" })));
    expect(await nameReadingSpansForWork(store, SETTINGS, "北の岬へ")).toEqual([{ start: 0, end: 3, reading: "きたのみさき" }]);
    expect(new TextDecoder().decode(await store.readFile(`${SETTINGS}/characters/char_001.json`))).toBe("{ こわれた");
  });
});
