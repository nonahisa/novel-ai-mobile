import { NOT_BUILT_MESSAGE, escapeHtml } from "./menuScreen";
import { episodeListRows, mobileWording, workCard, type EpisodeListRow, type WorkCard } from "./workListView";
import { toStorePath } from "../platform/paths";
import type { ScannedWork, WorkListItem } from "../platform/workScan";

/**
 * 作品一覧（A）と話の一覧（B）の HTML（設計書 4.2。見た目は画面の見本の札と一覧）。
 * 文字列で作るので、DOM の無いテストでも中身を確かめられる。配線は `shell.ts`。
 *
 * - 作品が1つも無い・話が1つも無いときは、空の形だけを置く（説明の文を並べない。設計書 4.6）
 * - 話を押すと原稿エディター（C）で開く（`data-episode` に置き場の根からの場所、`data-root` に作品）。
 *   競合の印のある話は開かない（保存がいつも止まる。直すのは同期の画面 G）
 */

/** 作品一覧（A）。押すと話の一覧を開く（`data-work`） */
export function renderWorkList(items: readonly WorkListItem[], now: Date): string {
  if (items.length === 0) return `<div class="work-list"><div class="work-empty" aria-hidden="true"></div></div>`;
  return `<div class="work-list">${items.map((item) => cardHtml(workCard(item, now))).join("")}</div>`;
}

function cardHtml(card: WorkCard): string {
  const meta = card.meta.length > 0 ? `<span class="work-meta">${card.meta.map((m) => `<span>${escapeHtml(m)}</span>`).join("")}</span>` : "";
  // 読めなかった作品の印は理由が長いので、丸めすぎない形（long）
  const long = card.meta.length === 0 ? " long" : "";
  const flags = card.flags.map((flag) => `<span class="flag ${flag.tone}${long}">${escapeHtml(flag.text)}</span>`).join("");
  return `<button class="work-card" data-work="${escapeHtml(card.root)}"><span class="work-title">${escapeHtml(card.title)}</span>${meta}${flags}</button>`;
}

/** 話の一覧（B）の中身（上のバーは `shell.ts`） */
export function renderEpisodeList(work: ScannedWork): string {
  const warn = work.chapterError ? `<p class="flag shu long work-warn">${escapeHtml(`⚠ 章立てを読めません：${mobileWording(work.chapterError)}`)}</p>` : "";
  const rows = episodeListRows(work);
  if (rows.length === 0) return `${warn}<div class="ep-list"><div class="work-empty" aria-hidden="true"></div></div>`;
  const next = `<button class="newep planned" aria-disabled="true" data-planned="${NOT_BUILT_MESSAGE}">続きを書く<span class="menu-badge">未</span></button>`;
  return `${warn}<div class="ep-list">${next}${rows.map((row) => rowHtml(row, work.root)).join("")}</div>`;
}

/** 競合の印のある話を押したとき */
export const CONFLICTED_EPISODE_MESSAGE = "競合が残っているので開けません";

function rowHtml(row: EpisodeListRow, root: string): string {
  if (row.type === "chapter") {
    const missing = row.missingStart ? `<span class="flag warn">開始の話が見つかりません</span>` : "";
    return `<h2 class="chap">${escapeHtml(row.name)}${missing}</h2>`;
  }
  const chars = row.conflict ? `<span class="flag shu">競合</span>` : escapeHtml(row.chars);
  const storePath = toStorePath(row.path);
  const open =
    row.conflict || storePath === undefined
      ? `aria-disabled="true" data-planned="${CONFLICTED_EPISODE_MESSAGE}"`
      : `data-episode="${escapeHtml(storePath)}" data-root="${escapeHtml(root)}"`;
  return `<button class="ep" ${open}><span class="no">${escapeHtml(row.no)}</span><span class="name">${escapeHtml(row.name)}</span><span class="chars">${chars}</span></button>`;
}

/** 読めなかった作品の話の一覧（理由だけ） */
export function renderWorkError(error: string): string {
  return `<p class="flag shu long work-warn">${escapeHtml(`⚠ ${error}`)}</p>`;
}
