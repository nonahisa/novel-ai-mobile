import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { caretFromNeighbors, ownCaretSize } from "../src/app/editableText";

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

describe("iOS の縦書き：既存の字の間でも、こちらの印を出す（2026-11-08 iPad mini・0.1.12：改行のあとにしか出なかった）", () => {
  const pane = readFileSync(new URL("../src/app/editablePane.ts", import.meta.url), "utf8");
  const quiet = pane.slice(pane.indexOf("const quietCaretRect"), pane.indexOf("let lastLoggedOffset"));
  test("前後の字の箱を、潰れた範囲の箱より先に使う", () => {
    expect(quiet.indexOf("if (box) return")).toBeGreaterThan(0);
    expect(quiet.indexOf("if (box) return")).toBeLessThan(quiet.lastIndexOf("rect.width > 0 || rect.height > 0 ? { rect"));
  });
  test("描画が止まっていても、50ms の時計で描く", () => {
    expect(pane).toContain("window.setTimeout(run, 50)");
  });
});

describe("自前の印の大きさ（2026-11-12 iPad mini・0.1.17：字の箱から出した位置には width が無く、印の幅が 0 だった）", () => {
  test("縦書きは、箱の左右の差（width が無くても）と字の大きさの大きいほう×2", () => {
    expect(ownCaretSize({ left: 556, right: 575, top: 523, bottom: 523 }, true, 16)).toEqual({ width: 19, height: 2 });
    expect(ownCaretSize({ left: 556, right: 556, top: 523, bottom: 523 }, true, 16)).toEqual({ width: 16, height: 2 });
  });
  test("横書きは 2×（箱の上下の差と字の大きさの大きいほう）", () => {
    expect(ownCaretSize({ left: 10, right: 10, top: 20, bottom: 44 }, false, 16)).toEqual({ width: 2, height: 24 });
  });
  test("欄は ownCaretSize で大きさを決める（at.width・at.height を直に読まない）", () => {
    expect(pane).toContain("ownCaretSize(at, vertical, lineHeight)");
    expect(pane).not.toMatch(/at\.width|at\.height/);
  });
  test("印の上の要素を測るあいだだけ、印も拾われるようにする", () => {
    expect(pane).toMatch(/pointerEvents = "auto";\s*\n\s*const top = document\.elementFromPoint/);
  });
});
