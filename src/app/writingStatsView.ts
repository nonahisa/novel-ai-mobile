import { escapeHtml } from "./menuScreen";
import { describeWrittenAmount } from "../shared";
import type { WritingSummary } from "../platform/writingStatsRead";

/**
 * **執筆統計（I）の HTML**（設計書 2章の I・3章「［ほか］→ 執筆統計（I）。今日の字数だけは作品一覧の上にも小さく出す」）。
 * 言い方は本体と同じ（`describeWrittenAmount`：「+560字」・削った日は「削った 12字」。負の数を出さない）。
 * 文字列で作るので、DOM の無いテストでも中身を確かめられる。配線は `shell.ts`
 */

/** この端末の分はまだ数えていないことを、統計の画面に書いておく（数が少なく見えても読み違えないように） */
export const NOT_RECORDED_HERE = "この端末で書いた分は、まだ数えていません。パソコンで書いた分を、同期で届いた記録から足しています";

export interface WorkWriting {
  root: string;
  title: string;
  summary: WritingSummary;
  /** 記録が1つでもあるか（無い作品は「記録なし」） */
  recorded: boolean;
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
export function renderWritingStats(rows: readonly WorkWriting[]): string {
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
  return `<div class="stats-screen">${head}${list}<p class="stats-note">${escapeHtml(NOT_RECORDED_HERE)}</p></div>`;
}
