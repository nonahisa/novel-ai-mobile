import { describe, expect, test } from "vitest";
import {
  type NodeLike,
  chunkAround,
  chunkSignature,
  composedHtml,
  readComposed,
  snapOutOfChunk,
  tokenizeComposed,
  widenToChunks,
} from "../src/app/composedText";
import { LINE_SUPPORT } from "../src/app/editableText";

/**
 * C（組んで書く）の決まり（2026-11-13 作者の答え「まず縦書きの試しで、本体と同じ『塊』の形を試す」）。
 * 欄に組んだ形は e2e（`e2e/composed.e2e.ts`）が見る。ここは DOM の無い所だけ
 */

const text = (value: string): NodeLike => ({ nodeType: 3, nodeName: "#text", nodeValue: value, childNodes: [] });
const el = (name: string, children: NodeLike[], src?: string): NodeLike => ({
  nodeType: 1,
  nodeName: name,
  nodeValue: null,
  childNodes: children,
  getAttribute: (n) => (n === "data-src" && src !== undefined ? src : null),
});

describe("本文を地の字と塊に分ける", () => {
  test("ルビ・傍点が塊になり、全部つなぐと元の本文", () => {
    const body = "{吾輩|わがはい}は猫である。{{頓と}}見当がつかぬ。";
    const tokens = tokenizeComposed(body);
    expect(tokens.map((t) => t.kind)).toEqual(["ruby", "text", "emphasis", "text"]);
    expect(tokens[0]).toMatchObject({ base: "吾輩", reading: "わがはい", start: 0 });
    expect(tokens[2]).toMatchObject({ inner: "頓と", start: body.indexOf("{{") });
    expect(tokens.map((t) => (t.kind === "text" ? t.text : t.src)).join("")).toBe(body);
  });

  test("傍点を先に見る（{{語}} が読みの無いルビに化けない）", () => {
    expect(tokenizeComposed("{{語}}")).toEqual([{ kind: "emphasis", start: 0, src: "{{語}}", inner: "語" }]);
  });

  test("読みの空のルビ・閉じていない記法は組まず、地の字のまま（本体と同じ）", () => {
    expect(tokenizeComposed("前{漢字|}後")).toEqual([{ kind: "text", start: 0, text: "前{漢字|}後" }]);
    expect(tokenizeComposed("{漢字|かん")).toEqual([{ kind: "text", start: 0, text: "{漢字|かん" }]);
  });

  test("空の本文は何も無い", () => {
    expect(tokenizeComposed("")).toEqual([]);
  });
});

describe("組んだ欄の HTML", () => {
  test("塊は contenteditable=false で、記法を data-src に持つ", () => {
    const html = composedHtml(tokenizeComposed("あ{漢字|かんじ}い{{語}}う"));
    expect(html).toBe(
      'あ<span class="chunk chunk-ruby" contenteditable="false" data-src="{漢字|かんじ}"><ruby>漢字<rt>かんじ</rt></ruby></span>' +
        'い<span class="chunk chunk-em" contenteditable="false" data-src="{{語}}"><span class="bouten">語</span></span>う'
    );
  });

  test("塊の両隣にはいつも字の節（欄の頭・末・塊が続く所は支えの字）", () => {
    const html = composedHtml(tokenizeComposed("{漢字|かんじ}{{語}}"));
    expect(html.startsWith(LINE_SUPPORT + "<span")).toBe(true);
    expect(html).toContain(`</span>${LINE_SUPPORT}<span`);
    expect(html.endsWith(`</span>${LINE_SUPPORT}`)).toBe(true);
  });

  test("本文が改行で終わるなら、最後の空の行の支えの字", () => {
    expect(composedHtml(tokenizeComposed("あ\n"))).toBe(`あ\n${LINE_SUPPORT}`);
    expect(composedHtml([])).toBe(LINE_SUPPORT);
  });

  test("地の字の < & は escape する（タグにならない）", () => {
    expect(composedHtml(tokenizeComposed("a<b&c"))).toBe("a&lt;b&amp;c");
  });
});

describe("欄を本文へ読み戻す（往復の安全弁の土台）", () => {
  test("字の節・塊・支えの字から、元の本文", () => {
    const root = el("DIV", [text(LINE_SUPPORT), el("SPAN", [el("RUBY", [text("漢字"), el("RT", [text("かんじ")])])], "{漢字|かんじ}"), text("は\n"), text(LINE_SUPPORT)]);
    expect(readComposed(root)).toBe("{漢字|かんじ}は\n");
  });

  test("ブラウザが作った <br>・<div> は改行。いちばん後ろの <br> は数えない", () => {
    expect(readComposed(el("DIV", [text("あ"), el("BR", []), text("い"), el("BR", [])]))).toBe("あ\nい");
    expect(readComposed(el("DIV", [text("あ"), el("DIV", [text("い")])]))).toBe("あ\nい");
  });

  test("塊の中の字（rt の読み）は本文に入れない。塊は記法で数える", () => {
    const root = el("DIV", [el("SPAN", [el("SPAN", [text("語")])], "{{語}}")]);
    expect(readComposed(root)).toBe("{{語}}");
  });

  test("塊の並びを比べる印", () => {
    expect(chunkSignature(tokenizeComposed("あ{漢字|かんじ}い{{語}}"))).toBe("{漢字|かんじ}\u0000{{語}}");
    expect(chunkSignature(tokenizeComposed("あい"))).toBe("");
  });
});

describe("カーソルと範囲は塊を割らない", () => {
  const tokens = tokenizeComposed("あ{漢字|かんじ}い");
  // 「あ」0、塊 1〜9（記法は8字）、「い」9
  test("塊の中の位置は、近いほうの端へ（同じなら後ろ）", () => {
    expect(chunkAround(tokens, 1)).toBeUndefined();
    expect(chunkAround(tokens, 3)?.src).toBe("{漢字|かんじ}");
    expect(snapOutOfChunk(tokens, 2)).toBe(1);
    expect(snapOutOfChunk(tokens, 8)).toBe(9);
    expect(snapOutOfChunk(tokens, 0)).toBe(0);
    expect(snapOutOfChunk(tokens, 9)).toBe(9);
  });

  test("塊にかかった範囲は、塊ごとに広げる", () => {
    expect(widenToChunks(tokens, 0, 3)).toEqual({ start: 0, end: 9 });
    expect(widenToChunks(tokens, 5, 10)).toEqual({ start: 1, end: 10 });
    expect(widenToChunks(tokens, 0, 1)).toEqual({ start: 0, end: 1 });
  });
});
