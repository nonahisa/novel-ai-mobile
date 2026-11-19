import { describe, expect, it } from "vitest";
import { phoneLandscapeKeyboard } from "./landscapeKeyboard";

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
