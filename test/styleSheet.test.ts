import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

/**
 * 画面の決まり（`src/style.css`）の括弧がそろっているか（引継ぎ書 75章）。
 * 2026-11-16、ぶつかりを直したときに `}` が1つ落ち、それより後ろの決まり（AI の札・有料の確認の窓）が
 * 前の決まりの中に入れ子になって効かなくなった。組み立ては通るので、ここで止める
 */
test("style.css の { と } がそろっていて、閉じすぎも無い", () => {
  const css = readFileSync(new URL("../src/style.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  let depth = 0;
  let lowest = 0;
  for (const ch of css) {
    if (ch === "{") depth += 1;
    if (ch === "}") depth -= 1;
    lowest = Math.min(lowest, depth);
  }
  expect({ depth, lowest }).toEqual({ depth: 0, lowest: 0 });
});
