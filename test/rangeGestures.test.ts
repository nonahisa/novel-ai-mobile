import { describe, expect, test } from "vitest";
import { KNOB_GAP_PX, handlePoints, wordAround } from "../src/app/rangeGestures";
import type { CharBox } from "../src/app/tapCaret";

/** 右の線の欄で、長押しとつまみで範囲を選ぶ（2026-11-18 作者の答え D）。DOM に触らない所を見張る */
describe("長押しで選ぶ語", () => {
  test("押した字を含む語（日本語の語の切れ目）", () => {
    const text = "姉から手紙が届いた。";
    expect(text.slice(...Object.values(wordAround(text, 4)))).toBe("手紙");
    expect(wordAround(text, 3)).toEqual(wordAround(text, 4));
  });
  test("記号・空白はその1字。改行と本文の外は選ばない", () => {
    const text = "雨。\n晴れ";
    expect(wordAround(text, 1)).toEqual({ start: 1, end: 2 });
    expect(wordAround(text, 2)).toEqual({ start: 2, end: 2 });
    expect(wordAround(text, 9)).toEqual({ start: 9, end: 9 });
  });
  test("語は行をまたがない", () => {
    const text = "手紙\n手紙";
    expect(wordAround(text, 3)).toEqual({ start: 3, end: 5 });
  });
});

describe("つまみの置き場", () => {
  const box = (i: number, top: number): CharBox => ({ i, n: 1, newline: false, left: 100, right: 120, top, bottom: top + 20 });
  const chars = [box(0, 0), box(1, 20), box(2, 40), box(3, 60)];
  test("縦書き：頭の丸は列の右・頭の字の上の端の高さ、末の丸は列の左・末の字の下の端の高さ（隣の字にかぶせない）", () => {
    expect(handlePoints(chars, 1, 3, true)).toEqual({ start: { x: 120 + KNOB_GAP_PX, y: 20, line: 20 }, end: { x: 100 - KNOB_GAP_PX, y: 60, line: 20 } });
  });
  test("横書き：頭の丸は行の上・頭の字の左の端、末の丸は行の下・末の字の右の端", () => {
    const row = [0, 1, 2].map((i): CharBox => ({ i, n: 1, newline: false, left: i * 20, right: i * 20 + 20, top: 0, bottom: 30 }));
    expect(handlePoints(row, 0, 2, false)).toEqual({ start: { x: 0, y: -KNOB_GAP_PX, line: 30 }, end: { x: 40, y: 30 + KNOB_GAP_PX, line: 30 } });
  });
  test("範囲の字が見当たらなければ置かない", () => {
    expect(handlePoints(chars, 5, 6, true)).toEqual({});
  });
});
