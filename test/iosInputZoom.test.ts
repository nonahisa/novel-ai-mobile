import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

/**
 * iOS は、字が 16px 未満の入力欄に焦点が入るとページを拡大し、左端が切れる
 * （2026-11-07 Mac の iOS シミュレーター。すべての機能の検索欄で起きた）。
 * 作者が打つ欄の字の大きさが 16px を下回っていないかを、見た目の決まり（style.css）から見張る。
 */

// コメントの中の字をセレクタと取り違えないよう、先に消す
const css = readFileSync(new URL("../src/style.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

/** そのセレクタの塊の中の、いちばん後ろの font-size（px）。無ければ undefined */
function fontSizePx(selector: string): number | undefined {
  const blocks = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(([, sel]) =>
    sel.split(",").map((s) => s.trim()).includes(selector)
  );
  let size: number | undefined;
  for (const [, , body] of blocks) {
    for (const m of body.matchAll(/font-size:\s*([\d.]+)px/g)) size = Number(m[1]);
  }
  return size;
}

describe("作者が打つ欄の字は 16px 以上", () => {
  test.each([".menu-search", "#rubySrc", ".ime-sink", ".draft-input", "#tategaki"])("%s", (selector) => {
    const size = fontSizePx(selector);
    expect(size, `${selector} に px の font-size が無い`).toBeDefined();
    expect(size!).toBeGreaterThanOrEqual(16);
  });
});
