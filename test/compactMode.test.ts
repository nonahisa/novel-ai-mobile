import { afterEach, describe, expect, test, vi } from "vitest";
import { isCompact, watchCompact } from "../src/app/compactMode";

/**
 * キーボードが出て見える所が低いときは、上下を細くする（2026-11-17 作者の答え：iPad mini を横にしてキーボードを出すと、
 * 本文の枠が約130pt・1列約7字しか見えなかった。直しの案1「キーボードが出たら上下を細くする」）
 */
describe("上下を細くするか", () => {
  test("横長で、見える高さが 480 より低いときだけ（iPad mini 横＋キーボード 1133×317）", () => {
    expect(isCompact(1133, 317)).toBe(true);
    expect(isCompact(1133, 744)).toBe(false); // 横でもキーボードが無い
    expect(isCompact(320, 368)).toBe(false); // AQUOS の縦＋キーボード（縦長はいまのまま）
    expect(isCompact(744, 1133)).toBe(false);
    expect(isCompact(480, 480)).toBe(false);
  });
});

describe("見える所の見張り", () => {
  afterEach(() => vi.unstubAllGlobals());
  test("見える所が変わるたびに、印（data-compact）と見える高さ（--vvh）を付け替える。外したら追わない", () => {
    const vv = Object.assign(new EventTarget(), { width: 1133, height: 744 });
    const win = Object.assign(new EventTarget(), { visualViewport: vv, innerWidth: 1133, innerHeight: 744 });
    const root = { dataset: {} as Record<string, string>, style: { setProperty: vi.fn() } };
    const stop = watchCompact(win as unknown as Window, root as unknown as HTMLElement);
    expect(root.dataset.compact).toBeUndefined();
    expect(root.style.setProperty).toHaveBeenLastCalledWith("--vvh", "744px");
    vv.height = 317;
    vv.dispatchEvent(new Event("resize"));
    expect(root.dataset.compact).toBe("on");
    expect(root.style.setProperty).toHaveBeenLastCalledWith("--vvh", "317px");
    vv.height = 744;
    vv.dispatchEvent(new Event("resize"));
    expect(root.dataset.compact).toBeUndefined();
    stop();
    vv.height = 317;
    vv.dispatchEvent(new Event("resize"));
    expect(root.dataset.compact).toBeUndefined();
  });
});
