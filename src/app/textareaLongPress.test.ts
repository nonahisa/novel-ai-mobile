import { describe, expect, it } from "vitest";
import { wantsIosTextareaFixes } from "./textareaLongPress";

describe("左の線の長押しの手当てを使うか", () => {
  const store = (value: string | null) => ({ getItem: () => value });
  it("iOS では使う", () => expect(wantsIosTextareaFixes("ios", store(null))).toBe(true));
  it("Android とブラウザでは使わない（端末の長押しで選べる）", () => {
    expect(wantsIosTextareaFixes("android", store(null))).toBe(false);
    expect(wantsIosTextareaFixes("web", undefined)).toBe(false);
  });
  it("試しの印があればブラウザでも使う", () => expect(wantsIosTextareaFixes("web", store("1"))).toBe(true));
});

describe("短く押した字のすぐ後ろへ（2026-11-19 夜 作者の決定）", async () => {
  const { caretAfterPressedChar } = await import("./textareaLongPress");
  // 縦書きの1列：「手」「紙」「\n」を上から 20px ずつ
  const col = [
    { i: 0, n: 1, newline: false, left: 0, right: 20, top: 0, bottom: 20 },
    { i: 1, n: 1, newline: false, left: 0, right: 20, top: 20, bottom: 40 },
    { i: 2, n: 1, newline: true, left: 0, right: 20, top: 40, bottom: 60 },
  ];
  it("字の上のほうを押しても、その字の後ろ", () => {
    expect(caretAfterPressedChar(col, 10, 22, true)).toBe(2);
    expect(caretAfterPressedChar(col, 10, 38, true)).toBe(2);
    expect(caretAfterPressedChar(col, 10, 2, true)).toBe(1);
  });
  it("改行の字を押したら改行の前（次の行へ飛ばない）", () => expect(caretAfterPressedChar(col, 10, 50, true)).toBe(2));
  it("字の無い所は右の線の欄と同じ決まり（列の下の先は列の末）", () => expect(caretAfterPressedChar(col.slice(0, 2), 10, 90, true)).toBe(2));
});
