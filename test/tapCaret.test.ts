import { describe, expect, test } from "vitest";
import { caretFromPoint, type CharBox } from "../src/app/tapCaret";
import { caretPlacement, isPlainShape, replaceRange } from "../src/app/editableText";

/**
 * 縦書きの見本：右の列「猫です\n」（x 80〜100）、左の列「犬」（x 50〜70）。字の高さは 20。
 * 列の下の端は、右の列が y 60（改行の字はそのあと、大きさ0）、左の列が y 20
 */
function verticalSample(): CharBox[] {
  const col = (left: number, chars: string[], start: number): CharBox[] =>
    chars.map((ch, k) => ({
      i: start + k,
      n: 1,
      newline: ch === "\n",
      left,
      right: ch === "\n" ? left : left + 20,
      top: k * 20,
      bottom: ch === "\n" ? k * 20 : k * 20 + 20,
    }));
  return [...col(80, ["猫", "で", "す", "\n"], 0), ...col(50, ["犬"], 4)];
}

describe("B：押した点からカーソルの位置を決める（2026-11-07 Mac：列の下を押すと本文の末へ飛んだ）", () => {
  const chars = verticalSample();

  test("字の上半分ならその字の前、下半分なら後ろ（前と同じ）", () => {
    expect(caretFromPoint(chars, 90, 5, true)).toBe(0);
    expect(caretFromPoint(chars, 90, 15, true)).toBe(1);
    expect(caretFromPoint(chars, 90, 25, true)).toBe(1);
  });

  test("列の下の端を少し越えた所は、本文の末ではなく、その列の末（改行の前）", () => {
    expect(caretFromPoint(chars, 90, 75, true)).toBe(3);
    expect(caretFromPoint(chars, 60, 300, true)).toBe(5);
  });

  test("列のあいだや欄の端を押したら、いちばん近い列", () => {
    expect(caretFromPoint(chars, 77, 5, true)).toBe(0);
    expect(caretFromPoint(chars, 20, 5, true)).toBe(4);
  });

  test("横書きは縦と横を入れ替えて同じ（行の終わりの先は、その行の末）", () => {
    const rows: CharBox[] = [
      { i: 0, n: 1, newline: false, left: 0, right: 20, top: 0, bottom: 20 },
      { i: 1, n: 1, newline: false, left: 20, right: 40, top: 0, bottom: 20 },
      { i: 2, n: 1, newline: true, left: 40, right: 40, top: 0, bottom: 0 },
      { i: 3, n: 1, newline: false, left: 0, right: 20, top: 30, bottom: 50 },
    ];
    expect(caretFromPoint(rows, 200, 10, false)).toBe(2);
    expect(caretFromPoint(rows, 15, 40, false)).toBe(4);
  });

  test("字が無ければ置かない", () => {
    expect(caretFromPoint([], 0, 0, true)).toBeUndefined();
  });
});

describe("A：欄の中身をいつも素直な形に保つ（2026-11-07 Mac G2a・G3）", () => {
  test("字の節1つ（改行で終わるなら支えの <br>）だけが素直な形", () => {
    expect(isPlainShape(["text"], "猫")).toBe(true);
    expect(isPlainShape(["text", "br"], "猫\n")).toBe(true);
    expect(isPlainShape([], "")).toBe(true);
    // Enter → ⌫ のあとに残った空の節や <br>、割れた字の節は作り直す
    expect(isPlainShape(["text", "text"], "猫です")).toBe(false);
    expect(isPlainShape(["text", "br", "text"], "猫です")).toBe(false);
    expect(isPlainShape(["text", "other"], "猫")).toBe(false);
    expect(isPlainShape(["text"], "猫\n")).toBe(false);
  });

  test("最後の空の行のカーソルは、支えの <br> の前に置く", () => {
    expect(caretPlacement("猫\n", 2)).toEqual({ kind: "beforeBreak" });
    expect(caretPlacement("猫\nです", 2)).toEqual({ kind: "text", offset: 2 });
    expect(caretPlacement("猫", 9)).toEqual({ kind: "text", offset: 1 });
  });

  test("Enter は選んだ所を改行に替え、カーソルはそのうしろ", () => {
    expect(replaceRange("猫です", 1, 1, "\n")).toEqual({ text: "猫\nです", caret: 2 });
    expect(replaceRange("猫です", 1, 3, "\n")).toEqual({ text: "猫\n", caret: 2 });
  });
});
