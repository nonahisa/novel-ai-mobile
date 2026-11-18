import { describe, expect, test } from "vitest";
import { renderTypoEstimate, typoResultText, renderEpisodePicker, pickedEpisodesText } from "../src/app/typoScreen";

/** 誤字脱字を走らせる前の見積もり（F）の4行と、走らせたあとの1行 */
describe("見積もりと結果の1行", () => {
  test("4行：話・字数・AI・料金。問題があれば［走らせる］を出さない", () => {
    const html = renderTypoEstimate({ episode: "第1話 手紙", chars: 12345, ai: "Claude・claude-a", priceLine: "AIを 2 回呼びます" });
    expect([...html.matchAll(/<dt>([^<]+)<\/dt>/g)].map((m) => m[1])).toEqual(["話", "字数", "AI", "料金"]);
    expect(html).toContain("約12,345字");
    expect(html).toContain('id="typoRun"');
    const blocked = renderTypoEstimate({ episode: "第1話", chars: 1, ai: undefined, priceLine: undefined, problem: "誤字脱字に使う AI がまだありません" });
    expect(blocked).not.toContain('id="typoRun"');
    expect(blocked).toContain('data-screen="ai"');
  });

  test("失敗は0件にしない", () => {
    expect(typoResultText({ findings: [], failures: [], calls: 1, rejected: 0 })).toBe("指摘 0件");
    expect(typoResultText({ findings: [], failures: [{ chunk: 1, reason: "AI の答えが途中で切れました" }], calls: 1, rejected: 2 })).toBe(
      "指摘 0件（本文と合わない 2件は外しました）。1か所は AI に見てもらえませんでした：AI の答えが途中で切れました"
    );
  });
});

describe("何話かまとめて（2026-11-18）", () => {
  const rows = [
    { path: "作/本文/1.txt", name: "第1話", conflicted: false },
    { path: "作/本文/2.txt", name: "第2話", conflicted: false },
    { path: "作/本文/4.txt", name: "第4話", conflicted: true },
  ];
  test("選んだ話に印。競合の話は選べない。選べる話を全部選ぶと［すべて］に印。何も選ばなければ［決める］を押せない", () => {
    const one = renderEpisodePicker(rows, new Set(["作/本文/1.txt"]));
    expect(one).toContain('data-pick="作/本文/1.txt" checked');
    expect(one).toContain('data-pick="作/本文/4.txt" disabled');
    expect(one).not.toContain('id="pickAll" checked');
    expect(renderEpisodePicker(rows, new Set(["作/本文/1.txt", "作/本文/2.txt"]))).toContain('id="pickAll" checked');
    expect(renderEpisodePicker(rows, new Set())).toContain('id="pickDone" disabled');
  });
  test("見積もりの「話」：1話ならその名前、何話かなら数と頭の話", () => {
    expect(pickedEpisodesText(["第1話 手紙"])).toBe("第1話 手紙");
    expect(pickedEpisodesText(["第1話 手紙", "第2話", "第3話"])).toBe("3話（第1話 手紙 ほか）");
  });
});
