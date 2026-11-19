import { describe, expect, it } from "vitest";
import { fittedHeight, MIN_FITTED_HEIGHT } from "../src/app/fitToVisible";

describe("キーボードが出ているとき、一覧の下の端を見える所の下の端に（2026-11-20 iPhone 17 シミュレーター 0.1.131）", () => {
  it("見える所がページの頭から：見える高さ − 一覧の頭", () => {
    expect(fittedHeight(41, 0, 150)).toBe(109);
  });
  it("見える所がページの途中へ動いていれば、その分だけ下まで", () => {
    expect(fittedHeight(41, 60, 150)).toBe(169);
  });
  it("低すぎるときは札1つ分は残す", () => {
    expect(fittedHeight(140, 0, 150)).toBe(MIN_FITTED_HEIGHT);
  });
});
