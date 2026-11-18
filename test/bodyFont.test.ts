import { describe, expect, test } from "vitest";
import { applyBodyFont, clampBodySize, parseBodyFont, pinchedSize, readBodyFont, readBodySize, renderBodyFontSection, writeBodyFont, writeBodySize } from "../src/app/bodyFont";

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

describe("本文の字の大きさ（設計書 5.2：2本指で広げる・つまむ。端末ごとに覚える）", () => {
  test("指の開き具合に比べて大きくする。12〜28px に収め、1px 刻み", () => {
    expect(pinchedSize(16, 100, 150)).toBe(24);
    expect(pinchedSize(16, 100, 50)).toBe(12);
    expect(pinchedSize(16, 100, 400)).toBe(28);
    expect(pinchedSize(16, 0, 100)).toBe(16);
    expect(clampBodySize(Number.NaN)).toBe(16);
  });
  test("覚えて読み戻す。無ければ 16px", () => {
    const map = new Map<string, string>();
    const storage = { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v) };
    expect(readBodySize(storage)).toBe(16);
    writeBodySize(storage, 21.4);
    expect(readBodySize(storage)).toBe(21);
  });
});
