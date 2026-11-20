import { describe, expect, it } from "vitest";
import { BARE_MAX_HEIGHT, barelyVisible, phoneLandscapeKeyboard } from "./landscapeKeyboard";

describe("横向きの電話でキーボードが出たか（2026-11-19 夜 作者の決定）", () => {
  // AQUOS（SH-M25）の横向きはおよそ 780×360
  const phone = { width: 780, height: 360, screenWidth: 780, screenHeight: 360 };
  it("横向きの電話でキーボードが出ると、そう見る", () => {
    expect(phoneLandscapeKeyboard({ ...phone, visibleHeight: 150 })).toBe(true);
    // Android は窓そのものが縮む
    expect(phoneLandscapeKeyboard({ ...phone, height: 150, visibleHeight: 150 })).toBe(true);
  });
  it("キーボードが無ければ替えない", () => expect(phoneLandscapeKeyboard({ ...phone, visibleHeight: 360 })).toBe(false));
  it("縦向きの電話は替えない（キーボードが出ていても）", () =>
    expect(phoneLandscapeKeyboard({ width: 360, height: 400, screenWidth: 360, screenHeight: 780, visibleHeight: 400 })).toBe(false));
  it("iPad は替えない（横向きでキーボードが出ていても）", () =>
    expect(phoneLandscapeKeyboard({ width: 1133, height: 744, screenWidth: 1133, screenHeight: 744, visibleHeight: 380 })).toBe(false));
});

describe("見える所がとても低いときは、上のバーも道具帯も隠す（2026-11-20 夜 作者の答え）", () => {
  const phone = { width: 780, height: 360, screenWidth: 780, screenHeight: 360 };
  it("AQUOS の横向き＋Gboard（見える高さ 123）は隠す", () => expect(barelyVisible({ ...phone, height: 123, visibleHeight: 123 })).toBe(true));
  it("見える所がそこまで低くなければ隠さない", () => {
    expect(BARE_MAX_HEIGHT).toBeLessThan(150);
    expect(barelyVisible({ ...phone, visibleHeight: 150 })).toBe(false);
  });
  it("キーボードが出ていなければ隠さない（縦向き・iPad も）", () => {
    expect(barelyVisible({ width: 360, height: 400, screenWidth: 360, screenHeight: 780, visibleHeight: 120 })).toBe(false);
    expect(barelyVisible({ width: 1133, height: 120, screenWidth: 1133, screenHeight: 744, visibleHeight: 120 })).toBe(false);
  });
});
