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

/*
  絵（画面の見本「Android版 画面デザイン」と同じ線の絵。24 の枡に 2 の線）。
  見本どおり、作品は本を2冊、書くはペン、提案は吹き出し、ほかは点3つ
*/
const ICON_BACK = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>`;
export const TAB_ICONS: Readonly<Record<PlannedTab["id"], string>> = {
  works: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 5h6v14H4zM14 5h6v14h-6z"/></svg>`,
  write: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 20l4-1 11-11-3-3L5 16z"/></svg>`,
  proposals: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M5 4h14v12H9l-4 4z"/></svg>`,
  other: `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="6" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="18" cy="12" r="1.8"/></svg>`,
};

/**
 * 上のバー（見本の topbar）。`back` なら左に丸い［戻る］、題の下に小さい補い（`sub`）。
 * `subId` を付けると、補いの所をあとから書き換えられる（縦書きの試しの字数）
 */
export function renderAppBar(title: string, options: { back?: boolean; sub?: string; subId?: string } = {}): string {
  const back = options.back ? `<button class="appbar-back" data-back aria-label="戻る">${ICON_BACK}</button>` : "";
  const sub =
    options.sub !== undefined || options.subId
      ? `<small${options.subId ? ` id="${options.subId}"` : ""}>${escapeHtml(options.sub ?? "")}</small>`
      : "";
  return `<header class="appbar">${back}<span class="appbar-title">${escapeHtml(title)}${sub}</span></header>`;
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
    ${renderAppBar(tab.screen, version ? { sub: version } : {})}
    <p class="menu-lead">設計書 4.3・4.4 の【案】のとおりに並べています。灰色の項目は、まだ作っていません。</p>
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
        `<button class="tab${tab.id === current ? " current" : ""}" data-tab="${tab.id}"${tab.id === current ? ' aria-current="page"' : ""}>${TAB_ICONS[tab.id]}${escapeHtml(tab.label)}</button>`
    )
    .join("");
}
