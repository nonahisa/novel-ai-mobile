import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

/**
 * こちらでカーソルの印を描いているあいだ、ブラウザの印を透明にする
 * （2026-11-08 iPad mini 実機・0.1.11：縦書きの最後の列で改行すると、こちらの太い印が列の頭に、
 * iOS の細い印が列の中ほどに出て、印が2本になった）
 */
const css = readFileSync(new URL("../src/style.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const pane = readFileSync(new URL("../src/app/editablePane.ts", import.meta.url), "utf8");

describe("A：こちらの印とブラウザの印が2本にならない", () => {
  test("own-caret-shown の欄では、ブラウザの印が透明", () => {
    expect(css).toMatch(/\.own-caret-shown\s*\{[^}]*caret-color:\s*transparent/);
  });
  test("印を出すときに付け、消すときに外す", () => {
    const show = pane.slice(pane.indexOf("const showOwnCaret"), pane.indexOf("const revealSelection"));
    const hide = pane.slice(pane.indexOf("const hideOwnCaret"), pane.indexOf("const showOwnCaret"));
    expect(show).toContain('classList.add("own-caret-shown")');
    expect(hide).toContain('classList.remove("own-caret-shown")');
  });
});
