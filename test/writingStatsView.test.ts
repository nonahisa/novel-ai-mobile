import { describe, expect, test } from "vitest";
import { NOT_RECORDED_HERE, renderWritingStats, todayLineHtml, totalOf, type WorkWriting } from "../src/app/writingStatsView";

const row = (title: string, today: number, week: number, recorded = true): WorkWriting => ({
  root: `${title}_確認用`,
  title,
  summary: { today, week },
  recorded,
});

describe("執筆統計（I）の見せ方", () => {
  test("全作品を足す", () => {
    expect(totalOf([row("灯台守", 300, 900), row("雪の駅", 260, 400)])).toEqual({ today: 560, week: 1300 });
  });

  test("作品一覧の上の1行は、記録のある作品が1つも無ければ出さない", () => {
    expect(todayLineHtml([])).toBeUndefined();
    expect(todayLineHtml([row("灯台守", 0, 0, false)])).toBeUndefined();
    expect(todayLineHtml([row("灯台守", 300, 900), row("雪の駅", 260, 400)])).toContain("今日 +560字");
  });

  test("削った日は負の数でなく「削った」と言う（本体と同じ言い方）", () => {
    const html = renderWritingStats([row("灯台守", -12, 30)]);
    expect(html).toContain("削った 12字");
    expect(html).not.toContain("-12");
  });

  test("記録の無い作品は「記録なし」。この端末の分はまだ数えていないと書く", () => {
    const html = renderWritingStats([row("灯台守", 300, 900), row("雪の駅", 0, 0, false)]);
    expect(html).toContain("今週</dt><dd>+900字");
    expect(html).toContain("記録なし");
    expect(html).toContain(NOT_RECORDED_HERE);
  });
});
