import { NOT_BUILT_MESSAGE, escapeHtml } from "./menuScreen";
import type { WorkSyncState } from "../platform/workSync";

/**
 * **同期の画面（G）**（設計書 6章。画面の見本は無いので、作品一覧・話の一覧の札と一覧の形にそろえる）。
 * 文字列で作るので、DOM の無いテストでも中身を確かめられる。配線は `shell.ts`（`#/sync/<作品>`）。
 *
 * - いちばん上に［取ってくる］［送る］。どちらも GitHub のサインインが要るので、いまは灰色（押すと「まだ作っていません」）
 * - その下に、送っていない話の一覧（話を押すと原稿エディターで開く。消した話は押せない）
 * - 送っていない話が無ければ「同期済み」の印だけ（説明の文を並べない。設計書 4.6）
 * - 競合の［こちら］［あちら］［両方残す］は次の段（取ってこられるようになってから）
 */

/** 消した話の印 */
export const DELETED_STORY_LABEL = "消した";

export function renderSyncScreen(root: string, state: WorkSyncState | undefined): string {
  const planned = (label: string) =>
    `<button class="planned" aria-disabled="true" data-planned="${NOT_BUILT_MESSAGE}">${escapeHtml(label)}<span class="menu-badge">未</span></button>`;
  const actions = `<div class="seg sync-actions">${planned("取ってくる")}${planned("送る")}</div>`;
  if (!state) return `${actions}<div class="ep-list"><div class="work-empty" aria-hidden="true"></div></div>`;
  const others = state.otherCount > 0 ? `<span class="flag warn">${escapeHtml(`ほかの変更：${state.otherCount}`)}</span>` : "";
  if (state.unsent.length === 0) {
    const flag = others || `<span class="flag ok">同期済み</span>`;
    return `${actions}<p class="sync-state">${flag}</p>`;
  }
  const rows = state.unsent
    .map((file) => {
      const name = file.path.slice(file.path.lastIndexOf("/") + 1).replace(/\.txt$/i, "");
      if (file.deleted) {
        return `<div class="ep" aria-disabled="true"><span class="no"></span><span class="name">${escapeHtml(name)}</span><span class="chars"><span class="flag warn">${DELETED_STORY_LABEL}</span></span></div>`;
      }
      return `<button class="ep" data-episode="${escapeHtml(file.path)}" data-root="${escapeHtml(root)}"><span class="no"></span><span class="name">${escapeHtml(name)}</span><span class="chars"></span></button>`;
    })
    .join("");
  return `${actions}<div class="ep-list sync-list"><h2 class="chap">${escapeHtml(`送っていない話：${state.unsent.length}`)}${others}</h2>${rows}</div>`;
}
