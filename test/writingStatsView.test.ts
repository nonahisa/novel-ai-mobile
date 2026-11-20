import { describe, expect, test } from "vitest";
import { RECORD_NOTE, dailyChartHtml, renderWritingStats, todayLineHtml, totalOf, type WorkWriting } from "../src/app/writingStatsView";

const row = (title: string, today: number, week: number, recorded = true): WorkWriting => ({
  root: `${title}_確認用`,
  title,
  summary: { today, week },
  recorded,
  days: [],
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
    expect(html).toContain(RECORD_NOTE);
  });
});

/** 執筆統計のグラフ（実装の残り 段3「残り：グラフ」。本体の日次の棒にならう。外の部品を使わず SVG で） */
describe("執筆統計のグラフ", () => {
  const withDays = (title: string, days: { date: string; net: number }[]): WorkWriting => ({ ...row(title, 0, 0), days });

  test("直近14日を、書かなかった日も0として並べ、全作品を足す。今日の棒は印を付ける", () => {
    const html = dailyChartHtml(
      [withDays("灯台守", [{ date: "2026-11-20", net: 300 }, { date: "2026-11-01", net: 999 }]), withDays("雪の駅", [{ date: "2026-11-20", net: 260 }, { date: "2026-11-10", net: 100 }])],
      "2026-11-20"
    )!;
    const bars = [...html.matchAll(/<rect class="stats-bar([^"]*)" data-date="([^"]+)" data-net="(-?\d+)"/g)].map((m) => [m[2], Number(m[3]), m[1].trim()]);
    expect(bars).toHaveLength(14);
    expect(bars[0]).toEqual(["2026-11-07", 0, ""]);
    expect(bars.find((b) => b[0] === "2026-11-10")).toEqual(["2026-11-10", 100, ""]);
    expect(bars[13]).toEqual(["2026-11-20", 560, "today"]);
    // 14日より前（11/1）は入れない
    expect(html).not.toContain("2026-11-01");
    expect(html).toContain('role="img"');
    expect(html).toContain("11/7");
    expect(html).toContain("11/20");
  });

  test("削った日は下へ伸ばし、色を分ける。月をまたいでも日が続く", () => {
    const html = dailyChartHtml([withDays("灯台守", [{ date: "2026-12-01", net: -40 }, { date: "2026-11-30", net: 80 }])], "2026-12-01")!;
    expect(html).toMatch(/<rect class="stats-bar negative today" data-date="2026-12-01" data-net="-40"/);
    expect(html).toContain('data-date="2026-11-30" data-net="80"');
    expect(html).toContain('data-date="2026-11-18"');
  });

  test("記録が1つも無ければグラフを出さない。統計の画面には今日の日付を渡したときだけ載る", () => {
    expect(dailyChartHtml([row("灯台守", 0, 0, false)], "2026-11-20")).toBeUndefined();
    const rows = [withDays("灯台守", [{ date: "2026-11-20", net: 300 }])];
    expect(renderWritingStats(rows, "2026-11-20")).toContain("stats-chart");
    expect(renderWritingStats(rows)).not.toContain("stats-chart");
  });
});
