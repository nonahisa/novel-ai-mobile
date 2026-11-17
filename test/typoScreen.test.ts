import { describe, expect, test } from "vitest";
import { renderTypoEstimate, typoResultText } from "../src/app/typoScreen";

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
