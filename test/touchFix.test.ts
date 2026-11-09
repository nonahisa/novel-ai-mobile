import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { nearestBoundary, shouldMoveCaret } from "../src/app/editableText";

/**
 * 縦書きで、押した所へカーソルを置き直す（本体の出先の原稿エディター nearestCaret・applyTouchFix に倣う。
 * 2026-11-09 iPad mini・0.1.15「押した所に印が出ない・ずれる」）
 */
// 縦の1列（左 80〜100）に 20 ずつ字が並ぶ：0字目 0〜20、1字目 20〜40、2字目 40〜60
const box = (i: number) => ({ left: 80, right: 100, top: i * 20, bottom: i * 20 + 20 });
const column = [
  { offset: 0, box: box(0), after: true },
  { offset: 1, box: box(1), after: true },
  { offset: 2, box: box(2), after: true },
  { offset: 3, box: box(2), after: false },
];

describe("押した点にいちばん近い字の境目", () => {
  test("字の上の辺が「その字の前」、最後は前の字の下の辺", () => {
    expect(nearestBoundary(column, 90, 22)).toBe(1);
    expect(nearestBoundary(column, 90, 38)).toBe(2);
    expect(nearestBoundary(column, 90, 58)).toBe(3);
  });
  test("列の外（字の幅より左右に離れた所）を押したら置き直さない", () => {
    expect(nearestBoundary(column, 40, 22)).toBeUndefined();
    expect(nearestBoundary([], 90, 22)).toBeUndefined();
  });
});

describe("iPad の置いた所から前後1字のときだけ置き直す", () => {
  test("1字ずれなら直す。同じ所・2字以上離れたらそのまま", () => {
    expect(shouldMoveCaret(4, 5)).toBe(true);
    expect(shouldMoveCaret(5, 4)).toBe(true);
    expect(shouldMoveCaret(5, 5)).toBe(false);
    expect(shouldMoveCaret(2, 5)).toBe(false);
  });
  test("iPad がまだ欄の中に置いていなければ直す", () => {
    expect(shouldMoveCaret(undefined, 3)).toBe(true);
  });
});

describe("欄につないである", () => {
  const pane = readFileSync(new URL("../src/app/editablePane.ts", import.meta.url), "utf8");
  test("iOS の縦書き（ownMode）で、指で押したときだけ・400ms 待ってから", () => {
    expect(pane).toMatch(/ownMode\(\) && e\.pointerType === "touch"/);
    expect(pane).toContain("TOUCH_FIX_MS = 400");
    expect(pane).toContain('element.addEventListener("pointerup", onTouchUp)');
    expect(pane).toContain('element.removeEventListener("pointerup", onTouchUp)');
  });
});

describe("自前の印は欄の親の中に置き、押すたびに記録を残す（2026-11-09 iPad mini・0.1.15「出ない」）", () => {
  const pane = readFileSync(new URL("../src/app/editablePane.ts", import.meta.url), "utf8");
  const css = readFileSync(new URL("../src/style.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  test("position:absolute で、body の直下に置かない", () => {
    expect(css).toMatch(/\.own-caret\s*\{[^}]*position:\s*absolute/);
    expect(pane).toContain("caretHost().appendChild(ownCaret)");
    expect(pane).not.toContain("document.body.appendChild(ownCaret)");
  });
  test("押した記録に、印の実際の位置と、印の上にある要素を出す", () => {
    expect(pane).toContain("A 押した：点");
    expect(pane).toContain("document.elementFromPoint");
  });
});
