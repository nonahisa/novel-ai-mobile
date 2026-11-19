import { describe, expect, it } from "vitest";
import { blocksTouchScroll } from "../src/app/scrollChainLock";

describe("キーボードが出ているとき、一覧の指の動きをページへ渡さない（2026-11-20 iPhone 17 シミュレーター 0.1.130）", () => {
  it("一覧が短くて送れないなら、どちらの向きでも止める（話が2つのとき）", () => {
    const box = { scrollTop: 0, scrollHeight: 120, clientHeight: 160 };
    expect(blocksTouchScroll(box, -10)).toBe(true);
    expect(blocksTouchScroll(box, 10)).toBe(true);
  });
  it("送れる一覧は、頭で指を下へ・末で指を上へのときだけ止める", () => {
    const top = { scrollTop: 0, scrollHeight: 600, clientHeight: 160 };
    expect(blocksTouchScroll(top, 10)).toBe(true);
    expect(blocksTouchScroll(top, -10)).toBe(false);
    const middle = { scrollTop: 200, scrollHeight: 600, clientHeight: 160 };
    expect(blocksTouchScroll(middle, 10)).toBe(false);
    expect(blocksTouchScroll(middle, -10)).toBe(false);
    const end = { scrollTop: 440, scrollHeight: 600, clientHeight: 160 };
    expect(blocksTouchScroll(end, -10)).toBe(true);
    expect(blocksTouchScroll(end, 10)).toBe(false);
  });
});
