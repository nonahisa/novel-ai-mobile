import { describe, expect, it } from "vitest";
import { exportCopy, exportTargets } from "./exportCopy";

describe("［…］→ 書き出し：投稿サイト向けの本文を写す（2026-11-19 夜 作者の決定）", () => {
  const site = (id: string) => exportTargets().find((t) => t.site === id)!;
  const body = "{灯台|とうだい}の{{手紙}}が届いた。\n// 付箋：ここは後で直す\n\n";

  it("貼り付け先はサイトの名前で並ぶ（本体と同じ一覧）", () => {
    expect(exportTargets().map((t) => t.label)).toEqual(expect.arrayContaining(["小説家になろう", "カクヨム"]));
  });

  it("投稿の台帳に登録した投稿先を先に並べる（本体と同じ）", () => {
    const labels = exportTargets(["kakuyomu"]).map((t) => t.label);
    expect(labels[0]).toBe("カクヨム");
    expect(exportTargets()[0]!.label).not.toBe("カクヨム");
  });

  it("カクヨム向け：ルビと傍点をカクヨムの書き方に、付箋の行を落とし、末の空行を詰める", () => {
    const result = exportCopy(body, { start: 0, end: 0 }, site("kakuyomu"));
    expect(result.text).toBe("｜灯台《とうだい》の《《手紙》》が届いた。");
    expect(result.message).toBe("カクヨム向けにコピーしました（21字）");
  });

  it("選んでいれば、そこだけ", () => {
    const result = exportCopy(body, { start: 0, end: 10 }, site("kakuyomu"));
    expect(result.text).toBe("｜灯台《とうだい》の");
    expect(result.message).toContain("選んだところを");
  });
});
