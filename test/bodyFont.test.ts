import { describe, expect, test } from "vitest";
import { applyBodyFont, parseBodyFont, readBodyFont, renderBodyFontSection, writeBodyFont } from "../src/app/bodyFont";

/** 本文の書体（2026-11-18 作者の答え「案3 なろう寄り」：既定はゴシック。［表示］で明朝と切り替える） */
describe("本文の書体", () => {
  test("既定はゴシック。知らない値もゴシック", () => {
    expect(parseBodyFont(null)).toBe("gothic");
    expect(parseBodyFont("serif")).toBe("gothic");
    expect(parseBodyFont("mincho")).toBe("mincho");
  });
  test("覚えて読み戻す。html に印を付ける", () => {
    const map = new Map<string, string>();
    const storage = { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v) };
    writeBodyFont(storage, "mincho");
    expect(readBodyFont(storage)).toBe("mincho");
    const root = { dataset: {} as Record<string, string> };
    applyBodyFont(root as unknown as HTMLElement, "mincho");
    expect(root.dataset.bodyFont).toBe("mincho");
  });
  test("選んでいる方に印", () => {
    expect(renderBodyFontSection("gothic")).toContain('data-body-font="gothic" aria-pressed="true"');
    expect(renderBodyFontSection("gothic")).toContain('data-body-font="mincho" aria-pressed="false"');
  });
});
