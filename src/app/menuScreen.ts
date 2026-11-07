import type { ActionEntry, PlannedItem, PlannedTab } from "./menuPlan";

/**
 * メニューの画面の HTML（文字列で作るので、DOM の無いテストでも中身を確かめられる）。
 * 配線（押したら開く・灰色を押したら知らせる）は `shell.ts`。
 *
 * **灰色の項目も「押せる形」にしておく**（`disabled` にはしない）。押せないと作者が
 * 「なぜ灰色なのか」を確かめられないので、押したら「まだ作っていません」と、置く予定の所を出す。
 * 読み上げには `aria-disabled="true"` で「使えない」と伝える。
 */

export const NOT_BUILT_MESSAGE = "まだ作っていません";

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function itemButton(item: PlannedItem): string {
  const note = item.note ? `<span class="menu-note">${escapeHtml(item.note)}</span>` : "";
  if (item.built) {
    return `<button class="menu-item built" data-screen="${item.built}">${escapeHtml(item.label)}${note}</button>`;
  }
  const tell = [NOT_BUILT_MESSAGE, item.note].filter(Boolean).join("。");
  return `<button class="menu-item planned" aria-disabled="true" data-planned="${escapeHtml(tell)}">${escapeHtml(item.label)}<span class="menu-badge">未</span>${note}</button>`;
}

/** タブの画面 */
export function renderTab(tab: PlannedTab, version?: string): string {
  const sections = tab.sections
    .map(
      (section) => `
      <section class="menu-section">
        <h2>${escapeHtml(section.title)}</h2>
        ${section.how ? `<p class="menu-how">${escapeHtml(section.how)}</p>` : ""}
        <div class="menu-items">${section.items.map(itemButton).join("")}</div>
      </section>`
    )
    .join("");
  return `
    <header class="appbar"><span class="appbar-title">${escapeHtml(tab.screen)}</span></header>
    <p class="menu-lead">設計書 4.3・4.4 の【案】のとおりに並べています。灰色の項目は、まだ作っていません。</p>
    ${version ? `<p class="menu-how">${escapeHtml(version)}</p>` : ""}
    ${sections}`;
}

/** 「すべての機能」の行 */
export function renderActionRows(entries: readonly ActionEntry[]): string {
  if (entries.length === 0) return `<p class="menu-empty">当てはまる機能がありません</p>`;
  return entries
    .map((entry) => {
      const path = [entry.group, entry.section].filter(Boolean).join(" › ");
      const ai = entry.usesAI ? `<span class="menu-ai">AI</span>` : "";
      const sub = `<span class="menu-note">${escapeHtml(path)}　置き場：${escapeHtml(entry.place)}</span>`;
      if (entry.built) {
        return `<button class="menu-item built" data-screen="${entry.built}">${escapeHtml(entry.label)}${ai}${sub}</button>`;
      }
      const tell = `${NOT_BUILT_MESSAGE}。置く予定の所：${entry.place}`;
      return `<button class="menu-item planned" aria-disabled="true" data-planned="${escapeHtml(tell)}">${escapeHtml(entry.label)}${ai}<span class="menu-badge">未</span>${sub}</button>`;
    })
    .join("");
}

/** 下のタブ */
export function renderTabBar(tabs: readonly PlannedTab[], current: string | undefined): string {
  return tabs
    .map(
      (tab) =>
        `<button class="tab${tab.id === current ? " current" : ""}" data-tab="${tab.id}"${tab.id === current ? ' aria-current="page"' : ""}>${escapeHtml(tab.label)}</button>`
    )
    .join("");
}
