import { describe, expect, test } from "vitest";
import { TERM_COLORS } from "../src/shared";
import { initialPaneState, renderPaneHtml } from "../src/app/editContextModel";
import { locateOffset, segmentsText, trailingBreakNeeded, type EditableSegment } from "../src/app/editableText";
import { renderSinkHtml, sinkDisplayState, type SinkState } from "../src/app/imeSinkModel";
import {
  SAMPLE_TERM_INPUT,
  buildTermIndex,
  findTermSpans,
  termColorCss,
  termEntriesFrom,
  type TermInput,
} from "../src/app/termHighlight";
import { SAMPLE_TEXT } from "../src/app/tategakiDraft";

const empty: TermInput = { character: "", location: "", ability: "", organization: "" };

describe("用語を探す（本体の索引を使う）", () => {
  test("種類ごとに読点・カンマ・改行で区切り、中黒の名前は片方でも当たる（本体と同じ広げ方）", () => {
    const entries = termEntriesFrom({ ...empty, character: "マルキオ・イークェス、灯", location: "図書塔,港" });
    const texts = entries.map((e) => `${e.kind}:${e.text}`);
    expect(texts).toEqual(
      expect.arrayContaining(["character:マルキオ・イークェス", "character:マルキオ", "character:イークェス", "character:灯", "location:図書塔", "location:港"])
    );
  });

  test("本文の中の位置と種類を返す。重なれば長いほう（本体と同じ最左最長）", () => {
    const index = buildTermIndex({ ...empty, character: "灯、灯火", location: "図書塔" });
    expect(findTermSpans(index, "灯火は図書塔へ。灯")).toEqual([
      { start: 0, end: 2, kind: "character" },
      { start: 3, end: 6, kind: "location" },
      { start: 8, end: 9, kind: "character" },
    ]);
  });

  test("見本の文では、初めから人物の語に色が付く（ルビの記法の中でも当たる）", () => {
    const spans = findTermSpans(buildTermIndex(SAMPLE_TERM_INPUT), SAMPLE_TEXT);
    expect(spans.length).toBeGreaterThan(0);
    expect(SAMPLE_TEXT.slice(spans[0].start, spans[0].end)).toBe("吾輩");
  });

  test("語が無ければ何も当たらない", () => {
    expect(findTermSpans(buildTermIndex(empty), SAMPLE_TEXT)).toEqual([]);
  });
});

describe("色は本体の TERM_COLORS から作る（16進を写さない）", () => {
  test("明るい画面・暗い画面の両方の色と、B のクラス・A の ::highlight の決まりが入る", () => {
    const css = termColorCss();
    expect(css).toContain(TERM_COLORS.character.light);
    expect(css).toContain(TERM_COLORS.organization.dark);
    expect(css).toContain("prefers-color-scheme: dark");
    expect(css).toContain(".term-location");
    expect(css).toContain("::highlight(term-ability)");
  });
});

describe("B：用語の字の span に種類のクラスを付ける", () => {
  test("当たった字だけに付き、変換中の線のクラスと並べて付く", () => {
    const state = { ...initialPaneState("我と灯火"), composing: true, formats: [{ start: 2, end: 4, style: "solid", thickness: "thin" }] };
    const html = renderPaneHtml(state, [{ start: 2, end: 4, kind: "character" }]);
    expect(html).toContain('<span data-i="1" data-n="1">と</span>');
    expect(html).toContain('<span data-i="2" data-n="1" class="comp term-character">灯</span>');
    expect(html).toContain('<span data-i="3" data-n="1" class="comp term-character">火</span>');
  });

  test("サロゲートペアの字も1つの span のまま色が付く", () => {
    const html = renderPaneHtml(initialPaneState("𠮷田です"), [{ start: 0, end: 3, kind: "character" }]);
    expect(html).toContain('<span data-i="0" data-n="2" class="term-character">𠮷</span>');
    expect(html).toContain('<span data-i="2" data-n="1" class="term-character">田</span>');
    expect(html).toContain('<span data-i="3" data-n="1">で</span>');
  });

  test("見えない受け口では、変換中の字を挟んだ本文で探した位置がそのまま当たる", () => {
    const sink: SinkState = { text: "港へ", selection: 0, composing: true, compText: "灯は" };
    const shown = sinkDisplayState(sink).text;
    expect(shown).toBe("灯は港へ");
    const spans = findTermSpans(buildTermIndex({ ...empty, character: "灯", location: "港" }), shown);
    const html = renderSinkHtml(sink, spans);
    expect(html).toContain('class="comp term-character">灯</span>');
    expect(html).toContain('class="term-location">港</span>');
  });
});

describe("A：contenteditable の中身と本文の位置の対応", () => {
  type N = string;
  const t = (node: N, text: string): EditableSegment<N> => ({ kind: "text", node, text });
  const br = (node: N): EditableSegment<N> => ({ kind: "newline", node });

  test("字の節と改行から本文を作る", () => {
    expect(segmentsText([t("a", "灯は"), br("b"), t("c", "港へ\n行く")])).toBe("灯は\n港へ\n行く");
  });

  test("範囲の頭と尻を、節の中の位置へ直す（節の境目では隣へはみ出さない）", () => {
    const segs = [t("a", "灯は"), br("b"), t("c", "港へ")];
    expect(locateOffset(segs, 0, "start")).toEqual({ node: "a", offset: 0 });
    expect(locateOffset(segs, 2, "end")).toEqual({ node: "a", offset: 2 });
    expect(locateOffset(segs, 3, "start")).toEqual({ node: "c", offset: 0 });
    expect(locateOffset(segs, 5, "end")).toEqual({ node: "c", offset: 2 });
  });

  test("ブラウザが字の節を割っても、またがる用語の範囲を作れる", () => {
    const segs = [t("a", "図書"), t("b", "塔へ")];
    expect(locateOffset(segs, 0, "start")).toEqual({ node: "a", offset: 0 });
    expect(locateOffset(segs, 3, "end")).toEqual({ node: "b", offset: 1 });
  });

  test("改行の上や本文の外は当たらない", () => {
    const segs = [t("a", "灯"), br("b")];
    expect(locateOffset(segs, 1, "start")).toBeUndefined();
    expect(locateOffset(segs, 9, "end")).toBeUndefined();
  });

  test("本文が改行で終わるときだけ、最後の空の行の支えの <br> を入れる", () => {
    expect(trailingBreakNeeded("灯\n")).toBe(true);
    expect(trailingBreakNeeded("灯")).toBe(false);
    expect(trailingBreakNeeded("")).toBe(false);
  });
});
