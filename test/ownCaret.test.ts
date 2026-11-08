import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { caretFromNeighbors } from "../src/app/editableText";

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



describe("iOS の縦書き：前後の字からカーソルの位置を決める（2026-11-08 iPad mini：iOS の印が大きくずれた）", () => {
  const a = { left: 80, right: 100, top: 20, bottom: 40 };
  const b = { left: 80, right: 100, top: 40, bottom: 60 };
  test("縦書きは、前の字の下の端。前が無ければ、うしろの字の上の端", () => {
    expect(caretFromNeighbors(a, b, true)).toEqual({ left: 80, right: 100, top: 40, bottom: 40 });
    expect(caretFromNeighbors(undefined, b, true)).toEqual({ left: 80, right: 100, top: 40, bottom: 40 });
  });
  test("横書きは、前の字の右の端。前が無ければ、うしろの字の左の端", () => {
    expect(caretFromNeighbors(a, undefined, false)).toEqual({ left: 100, right: 100, top: 20, bottom: 40 });
    expect(caretFromNeighbors(undefined, a, false)).toEqual({ left: 80, right: 80, top: 20, bottom: 40 });
  });
  test("前後とも無ければ決めない", () => {
    expect(caretFromNeighbors(undefined, undefined, true)).toBeUndefined();
  });
  test("iOS のときだけ、縦書きで印をいつもこちらで描く", () => {
    const shell = readFileSync(new URL("../src/app/shell.ts", import.meta.url), "utf8");
    expect(shell).toContain('ownCaretWhenVertical: Capacitor.getPlatform() === "ios"');
  });
});
