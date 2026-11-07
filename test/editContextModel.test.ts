import { describe, expect, test } from "vitest";
import {
  applyTextUpdate,
  editAtCaret,
  editContextSupport,
  initialPaneState,
  lineClassAt,
  renderPaneHtml,
  type PaneState,
} from "../src/app/editContextModel";

/**
 * B（右傍線）の中身（作者の頼み 2026-11-07）。IME の知らせを本文へ当てる・変換中の字に線のクラスを付ける・
 * 改行と削除をページが受け持つ・使えない端末では理由を出す、を見張る。線が右に出るかは実機で見る。
 */

const composing = (text: string, formats: PaneState["formats"], selection = text.length): PaneState => ({
  text,
  selection,
  composing: true,
  formats,
});

describe("IME の知らせを本文へ当てる", () => {
  test("変換中の字を置き換え、確定の字に替えていく", () => {
    let s = initialPaneState("朝の");
    s = applyTextUpdate(s, { start: 2, end: 2, text: "えき", selection: 4 });
    expect(s).toMatchObject({ text: "朝のえき", selection: 4 });
    s = applyTextUpdate(s, { start: 2, end: 4, text: "駅", selection: 3 });
    expect(s).toMatchObject({ text: "朝の駅", selection: 3 });
  });

  test("範囲が本文の外を指しても、本文を壊さない", () => {
    const s = applyTextUpdate(initialPaneState("あい"), { start: 5, end: 9, text: "う", selection: 99 });
    expect(s).toMatchObject({ text: "あいう", selection: 3 });
  });
});

describe("変換中の線（線の向きは CSS。ここではどの字に線を引くか）", () => {
  test("変換中の区切りの字にだけ線。太い区切りは thick、点線などは形の名前", () => {
    const s = composing("今日はいい", [
      { start: 0, end: 2, style: "solid", thickness: "thick" },
      { start: 2, end: 5, style: "dotted", thickness: "thin" },
    ]);
    expect(lineClassAt(s, 0)).toBe("comp thick");
    expect(lineClassAt(s, 3)).toBe("comp dotted");
  });

  test("Android の WebView の形（大文字で始まる・線なしの区切りが重なる）でも線を引く", () => {
    const s = composing("きょう", [
      { start: 0, end: 3, style: "None", thickness: "None" },
      { start: 0, end: 3, style: "Solid", thickness: "Thin" },
    ]);
    expect(lineClassAt(s, 1)).toBe("comp");
    expect(lineClassAt(composing("あ", [{ start: 0, end: 1, style: "Dashed", thickness: "Thick" }]), 0)).toBe("comp thick dashed");
  });

  test("形が none の区切りと、変換していないときは線を引かない", () => {
    expect(lineClassAt(composing("あい", [{ start: 0, end: 2, style: "none", thickness: "none" }]), 0)).toBe("");
    expect(lineClassAt(initialPaneState("あい"), 0)).toBe("");
  });

  test("1字ずつ span にし、カーソルの位置に印を置く。< & はタグにしない", () => {
    const html = renderPaneHtml({ ...composing("a<b", [{ start: 0, end: 1, style: "solid", thickness: "thin" }]), selection: 1 });
    expect(html).toBe(
      '<span data-i="0" data-n="1" class="comp">a</span><span class="caret" aria-hidden="true"></span><span data-i="1" data-n="1">&lt;</span><span data-i="2" data-n="1">b</span>'
    );
  });

  test("𠮷 のような2単位の字は1つの span にまとめる", () => {
    const html = renderPaneHtml(initialPaneState("𠮷野"));
    expect(html).toContain('<span data-i="0" data-n="2">𠮷</span><span data-i="2" data-n="1">野</span>');
  });
});

describe("改行・削除はページが受け持つ", () => {
  test("改行はカーソルの位置に入る", () => {
    const done = editAtCaret({ ...initialPaneState("あい"), selection: 1 }, "newline");
    expect(done).toMatchObject({ start: 1, end: 1, inserted: "\n", state: { text: "あ\nい", selection: 2 } });
  });

  test("後ろへ消す（Backspace）は2単位の字を割らない。頭では何もしない", () => {
    expect(editAtCaret(initialPaneState("野𠮷"), "backspace")).toMatchObject({ start: 1, end: 3, state: { text: "野", selection: 1 } });
    expect(editAtCaret({ ...initialPaneState("あ"), selection: 0 }, "backspace")).toBeUndefined();
  });

  test("前へ消す（Delete）は2単位の字を割らない。末尾では何もしない", () => {
    expect(editAtCaret({ ...initialPaneState("𠮷野"), selection: 0 }, "delete")).toMatchObject({ start: 0, end: 2, state: { text: "野" } });
    expect(editAtCaret(initialPaneState("あ"), "delete")).toBeUndefined();
  });
});

describe("B を使えるか", () => {
  test("EditContext があれば使える", () => {
    expect(editContextSupport({ EditContext: class {} }, "android")).toEqual({ ok: true });
  });
  test("iOS で無ければ、押せなくして理由を出す（自前で線を描く作りが要る）", () => {
    const answer = editContextSupport({}, "ios");
    expect(answer.ok).toBe(false);
    if (!answer.ok) expect(answer.reason).toContain("WKWebView");
  });
  test("ほかで無ければ、部品の版が足りないと出す", () => {
    const answer = editContextSupport({}, "android");
    expect(answer.ok).toBe(false);
    if (!answer.ok) expect(answer.reason).toContain("EditContext");
  });
});
