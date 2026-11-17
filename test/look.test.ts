import { describe, expect, test } from "vitest";
import { LOOKS, applyLook, parseLook, readLook, renderLookSection, writeLook } from "../src/app/look";

/** 見た目の案を選ぶ（設定 → 表示 → 見た目。2026-11-18 作者「選べるようにしてください」） */
describe("見た目の案", () => {
  test("4つ：標準・和紙と墨・白と藍・墨と朱。覚えていない・知らない値は既定の白と藍（2026-11-18 作者の答え）", () => {
    expect(LOOKS.map((look) => look.label)).toEqual(["標準", "和紙と墨", "白と藍", "墨と朱"]);
    expect(parseLook(null)).toBe("hakuai");
    expect(parseLook("neon")).toBe("hakuai");
    expect(parseLook("standard")).toBe("standard");
    expect(parseLook("washi")).toBe("washi");
  });

  test("覚えて読み戻す。標準を選んだら標準と覚える（既定の白と藍にしない）", () => {
    const map = new Map<string, string>();
    const storage = { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v), removeItem: (k: string) => void map.delete(k) };
    writeLook(storage, "sumishu");
    expect(readLook(storage)).toBe("sumishu");
    writeLook(storage, "standard");
    expect(map.get("novelai.look")).toBe("standard");
    expect(readLook(storage)).toBe("standard");
    map.clear();
    expect(readLook(storage)).toBe("hakuai");
  });

  test("html に印を付ける。標準は印を外す", () => {
    const root = { dataset: {} as Record<string, string> };
    applyLook(root as unknown as HTMLElement, "hakuai");
    expect(root.dataset.look).toBe("hakuai");
    applyLook(root as unknown as HTMLElement, "standard");
    expect(root.dataset.look).toBeUndefined();
  });

  test("表示の画面の見た目の段：選んでいるものだけ押されている", () => {
    const html = renderLookSection("washi");
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(html).toContain('data-look-choice="washi" aria-pressed="true"');
  });
});
