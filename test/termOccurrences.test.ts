import { describe, expect, test } from "vitest";
import { findTermOccurrences } from "../src/app/termOccurrences";

/** 設計書 5.7「資料の側からは、その名前が出る話と行を並べ、押すとその場所へ飛ぶ」 */
const entries = [
  { text: "マルキオ・イークェス", kind: "character" as const, id: "char_001", canonicalName: "マルキオ・イークェス" },
  { text: "マルキオ", kind: "character" as const, id: "char_001", canonicalName: "マルキオ・イークェス" },
  { text: "灯守", kind: "character" as const, id: "char_001", canonicalName: "マルキオ・イークェス" },
  { text: "マルキオの灯台", kind: "location" as const, id: "loc_001", canonicalName: "マルキオの灯台" },
];
const docs = [
  { path: "w/本文/第1話.txt", text: "朝。\nマルキオは灯守と呼ばれた。\n夜。" },
  { path: "w/本文/第2話.txt", text: "マルキオの灯台へ行く。\n" },
  { path: "w/本文/第3話.txt", text: "マルキオ・イークェスが来た" },
];

describe("名前が出る話と行（本体の索引で、同じ資料の語を探す）", () => {
  test("同じ資料の名前・別名を、話の順・行の順に並べる。行の番号と、その字の場所を持つ", () => {
    const found = findTermOccurrences(entries, "char_001", docs);
    expect(found.hits.map((h) => [h.path, h.line, h.text])).toEqual([
      ["w/本文/第1話.txt", 2, "マルキオ"],
      ["w/本文/第1話.txt", 2, "灯守"],
      ["w/本文/第3話.txt", 1, "マルキオ・イークェス"],
    ]);
    expect(found.hits[1].offset).toBe(docs[0].text.indexOf("灯守"));
    expect(found.more).toBe(false);
  });

  test("長い別の語の中の名前は数えない（色と同じ最左最長）", () => {
    const found = findTermOccurrences(entries, "char_001", docs);
    expect(found.hits.some((h) => h.path === "w/本文/第2話.txt")).toBe(false);
    expect(findTermOccurrences(entries, "loc_001", docs).hits.map((h) => h.path)).toEqual(["w/本文/第2話.txt"]);
  });

  test("行の抜き出しは前後を短く切る", () => {
    const long = "あ".repeat(40) + "マルキオ" + "い".repeat(40);
    const [hit] = findTermOccurrences(entries, "char_001", [{ path: "x", text: long }]).hits;
    expect(hit.excerpt).toBe("…" + "あ".repeat(12) + "マルキオ" + "い".repeat(20) + "…");
    expect(findTermOccurrences(entries, "char_001", docs).hits[0].excerpt).toBe("マルキオは灯守と呼ばれた。");
  });

  test("多すぎれば上限で止め、まだあると返す。無い語・空の本文は0件", () => {
    const many = [{ path: "x", text: "マルキオ\n".repeat(30) }];
    const found = findTermOccurrences(entries, "char_001", many, 10);
    expect(found.hits).toHaveLength(10);
    expect(found.more).toBe(true);
    expect(findTermOccurrences(entries, "none", docs).hits).toEqual([]);
    expect(findTermOccurrences([], "char_001", docs).hits).toEqual([]);
  });
});
