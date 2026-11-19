import { describe, expect, it } from "vitest";
import { committedArrived, rememberedBroken, VERTICAL_INPUT_BROKEN_KEY } from "./verticalInputCheck";

describe("打った字が本文へ届いたか（設計書 5.3 の2）", () => {
  it("確定した字がカーソルのすぐ前にあれば届いた", () => {
    expect(committedArrived("姉から猫", 4, "猫")).toBe(true);
    expect(committedArrived("姉から猫が", 4, "猫")).toBe(true);
    // 既にある語の上で変換をやり直した（本文の字は増えない）
    expect(committedArrived("手紙が届いた", 2, "手紙")).toBe(true);
  });
  it("無い・別の所にあるなら食い違い", () => {
    expect(committedArrived("姉から", 3, "猫")).toBe(false);
    expect(committedArrived("猫姉から", 4, "猫")).toBe(false);
    expect(committedArrived("", 0, "猫")).toBe(false);
  });
  it("中身の無い確定は見ない", () => expect(committedArrived("姉", 1, "")).toBe(true));
  it("崩れた端末は、同じ名乗りのときだけ覚えている", () => {
    const store = new Map<string, string>([[VERTICAL_INPUT_BROKEN_KEY, "端末A"]]);
    const storage = { getItem: (k: string) => store.get(k) ?? null };
    expect(rememberedBroken(storage, "端末A")).toBe(true);
    expect(rememberedBroken(storage, "端末B")).toBe(false);
    expect(rememberedBroken(undefined, "端末A")).toBe(false);
  });
});
