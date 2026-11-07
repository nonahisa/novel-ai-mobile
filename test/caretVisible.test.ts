import { describe, expect, test } from "vitest";
import { caretScrollDelta } from "../src/app/caretVisible";

/**
 * キーボードが出ても、カーソルのある所を見える位置へ送る量（2026-11-07 Mac の iOS シミュレーター：
 * 縦書きの欄がキーボードの下に隠れた）。見える範囲は visualViewport（キーボードの分だけ縮む）。
 */

const band = { top: 0, height: 400 }; // キーボードが出て、上の 400 だけが見えている

describe("カーソルを見える所へ送る量", () => {
  test("キーボードの下に隠れていれば、その分だけ下へ送る（下の余白 48 を空ける）", () => {
    expect(caretScrollDelta({ top: 600, bottom: 620 }, band)).toBe(620 - (400 - 48));
  });
  test("上のバーの下に隠れていれば、上へ戻す（上の余白 64 を空ける）", () => {
    expect(caretScrollDelta({ top: 10, bottom: 30 }, band)).toBe(10 - 64);
  });
  test("見えていれば送らない", () => {
    expect(caretScrollDelta({ top: 200, bottom: 220 }, band)).toBe(0);
  });
  test("ページが拡大・ずらされていても、見える範囲の上の端から測る（iOS の visualViewport.offsetTop）", () => {
    expect(caretScrollDelta({ top: 400, bottom: 420 }, { top: 250, height: 400 })).toBe(0);
    expect(caretScrollDelta({ top: 260, bottom: 280 }, { top: 250, height: 400 })).toBe(260 - (250 + 64));
  });
});
