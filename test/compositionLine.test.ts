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
  expect(renderLineSection("right")).toContain("テスト中：コピー・切り取り・貼り付けはまだできません");
});

/** 左の線の欄の用語の色（テスト中。引継ぎ書 87章）。左のときだけ選べ、既定は付けない */
test("用語の色の選びは左のときだけ出し、既定は［付けない］", () => {
  expect(renderLineSection("left")).toContain(`data-term-colors="off" aria-pressed="true"`);
  expect(renderLineSection("left", true)).toContain(`data-term-colors="on" aria-pressed="true"`);
  expect(renderLineSection("left", true)).toContain("付ける（テスト中）");
  expect(renderLineSection("right", true)).not.toContain("data-term-colors");
});
