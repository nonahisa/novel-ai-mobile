import { escapeHtml } from "./menuScreen";
import { describeWrittenAmount } from "../shared";
import type { WritingDay, WritingSummary } from "../platform/writingStatsRead";

/**
 * **執筆統計（I）の HTML**（設計書 2章の I・3章「［ほか］→ 執筆統計（I）。今日の字数だけは作品一覧の上にも小さく出す」）。
 * 言い方は本体と同じ（`describeWrittenAmount`：「+560字」・削った日は「削った 12字」。負の数を出さない）。
 * 文字列で作るので、DOM の無いテストでも中身を確かめられる。配線は `shell.ts`
 */

/** どこで書いた分を足しているかを、統計の画面に書いておく（2026-11-20 夜からこの端末の分も数える。`writingStatsRecord.ts`） */
export const RECORD_NOTE = "この端末で書いた分と、パソコンなどで書いた分（同期で届いた記録）を足しています";

export interface WorkWriting {
  root: string;
  title: string;
  summary: WritingSummary;
  /** 記録が1つでもあるか（無い作品は「記録なし」） */
  recorded: boolean;
  /** 全端末を足した日ごとの記録（グラフに使う） */
  days: readonly WritingDay[];
}

/** 全作品を足す */
export function totalOf(rows: readonly WorkWriting[]): WritingSummary {
  return rows.reduce((sum, row) => ({ today: sum.today + row.summary.today, week: sum.week + row.summary.week }), { today: 0, week: 0 });
}

/** 作品一覧の上の小さい1行。どの作品にも記録が無ければ出さない（undefined） */
export function todayLineHtml(rows: readonly WorkWriting[]): string | undefined {
  if (!rows.some((row) => row.recorded)) return undefined;
  return `<a class="today-amount" href="#/stats">今日 ${escapeHtml(describeWrittenAmount(totalOf(rows).today))}</a>`;
}

/** 執筆統計の画面の中身（上のバーは `shell.ts`） */
export function renderWritingStats(rows: readonly WorkWriting[], today?: string): string {
  const total = totalOf(rows);
  const head = `<dl class="stats-total"><div><dt>今日</dt><dd>${escapeHtml(describeWrittenAmount(total.today))}</dd></div><div><dt>今週</dt><dd>${escapeHtml(describeWrittenAmount(total.week))}</dd></div></dl>`;
  const list =
    rows.length === 0
      ? ""
      : `<h2 class="stats-head">作品ごと</h2><ul class="stats-works">${rows
          .map((row) => {
            const amounts = row.recorded
              ? `<span>今日 ${escapeHtml(describeWrittenAmount(row.summary.today))}</span><span>今週 ${escapeHtml(describeWrittenAmount(row.summary.week))}</span>`
              : `<span>記録なし</span>`;
            return `<li data-work="${escapeHtml(row.root)}"><span class="stats-title">${escapeHtml(row.title)}</span><span class="stats-amounts">${amounts}</span></li>`;
          })
          .join("")}</ul>`;
  const chart = today === undefined ? undefined : dailyChartHtml(rows, today);
  return `<div class="stats-screen">${head}${chart ?? ""}${list}<p class="stats-note">${escapeHtml(RECORD_NOTE)}</p></div>`;
}

/** グラフに並べる日数（電話の幅でも棒と日付が読める本数。本体の日次は30本） */
export const CHART_DAYS = 14;

const pad2 = (n: number) => String(n).padStart(2, "0");

/** YYYY-MM-DD を何日かずらす（UTC の上で。夏時間でずれない。本体の `addDays` と同じ） */
function shiftDay(key: string, days: number): string {
  const [year, month, day] = key.split("-").map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day! + days));
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

const shortLabel = (key: string) => `${Number(key.slice(5, 7))}/${Number(key.slice(8, 10))}`;

/**
 * **直近14日の字数の棒グラフ**（実装の残り 段3「残り：グラフ」）。本体の執筆統計の日次の棒にならい、外の部品を使わず SVG で組む。
 * - 書かなかった日も0として並べる（本体の `aggregate` と同じ。書いた日だけ並べると、毎日書いているように見える）
 * - 全作品を足す（上の「今日」「今週」と同じ数）。削った日は下へ伸ばし、色を分ける。今日の棒は色を変える
 * - どの作品にも記録が無ければ出さない（undefined）
 */
export function dailyChartHtml(rows: readonly WorkWriting[], today: string): string | undefined {
  if (!rows.some((row) => row.recorded)) return undefined;
  const totals = new Map<string, number>();
  for (const row of rows) for (const day of row.days) totals.set(day.date, (totals.get(day.date) ?? 0) + day.net);
  const keys = Array.from({ length: CHART_DAYS }, (_, i) => shiftDay(today, i - (CHART_DAYS - 1)));
  const values = keys.map((key) => totals.get(key) ?? 0);
  const max = Math.max(0, ...values);
  const min = Math.min(0, ...values);
  const span = max - min || 1;
  const step = 20;
  const barWidth = 14;
  const top = 6;
  const height = 100;
  const zero = top + (max / span) * height;
  const bars = keys
    .map((key, i) => {
      const net = values[i]!;
      const h = (Math.abs(net) / span) * height;
      const y = net >= 0 ? zero - h : zero;
      const cls = [net < 0 ? "negative" : "", key === today ? "today" : ""].filter(Boolean).join(" ");
      return `<rect class="stats-bar${cls ? ` ${cls}` : ""}" data-date="${key}" data-net="${net}" x="${i * step + 3}" y="${y.toFixed(1)}" width="${barWidth}" height="${Math.max(h, net === 0 ? 0 : 1).toFixed(1)}"><title>${escapeHtml(`${shortLabel(key)} ${describeWrittenAmount(net)}`)}</title></rect>`;
    })
    .join("");
  const width = CHART_DAYS * step;
  // 日付は端と真ん中だけ（14本ぶん全部書くと重なる）。端の2つは棒の外の縁にそろえる（真ん中寄せだと半分が枠の外へ出て切れる）
  const axis = (x: number, anchor: string, key: string) =>
    `<text class="stats-axis" x="${x}" y="${top + height + 16}" text-anchor="${anchor}">${shortLabel(key)}</text>`;
  const labels =
    axis(3, "start", keys[0]!) + axis(7 * step + 3 + barWidth / 2, "middle", keys[7]!) + axis(width, "end", keys[CHART_DAYS - 1]!);
  const label = `直近${CHART_DAYS}日の字数（${shortLabel(keys[0]!)}〜${shortLabel(today)}）。今日 ${describeWrittenAmount(values[CHART_DAYS - 1]!)}`;
  return (
    `<h2 class="stats-head">直近${CHART_DAYS}日</h2>` +
    `<div class="stats-chart"><svg viewBox="0 0 ${width} ${top + height + 22}" role="img" aria-label="${escapeHtml(label)}">` +
    `<line class="stats-zero" x1="0" x2="${width}" y1="${zero.toFixed(1)}" y2="${zero.toFixed(1)}" />${bars}${labels}</svg></div>`
  );
}
