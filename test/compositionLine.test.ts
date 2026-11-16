import { expect, test } from "vitest";
import { COMPOSITION_LINE_KEY, parseCompositionLine } from "../src/app/episodeScreen";
import { renderLineSection } from "../src/app/displayScreen";

/** 変換中の線（左が既定・右はテスト中。引継ぎ書 76章）。名前と値は拡張機能とそろえる */
test("名前は novelai.compositionLine、値は left／right、既定は left。右を選ぶとテスト中の断り", () => {
  expect(COMPOSITION_LINE_KEY).toBe("novelai.compositionLine");
  expect(parseCompositionLine(null)).toBe("left");
  expect(parseCompositionLine("right")).toBe("right");
  expect(parseCompositionLine("こわれた")).toBe("left");
  expect(renderLineSection("left")).toContain(`data-line="left" aria-pressed="true"`);
  expect(renderLineSection("left")).not.toContain("テスト中：");
  expect(renderLineSection("right")).toContain("右（テスト中）");
  expect(renderLineSection("right")).toContain("テスト中：範囲を選べないので");
});
