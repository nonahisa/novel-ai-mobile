import { escapeHtml } from "./menuScreen";

/**
 * **最後に開いた話**（設計書 4.3「［書く］は最後に開いた話を開く」）。
 *
 * 原稿エディターで話を開くたびに端末ごとに覚え（`localStorage`）、［書く］のタブのいちばん上に
 * その話の札を置く。押すと原稿エディターで開く（`data-episode`・`data-root`。配線は `shell.ts`）。
 * タブを押しただけで話へ飛ぶ形にはしていない：［書く］には縦書きの試しも並んでいる（作者が試している最中）。
 *
 * 覚えるのは作品と話の場所だけ（原稿の字は覚えない）。場所が作品の外を指していたら `shell.ts` が捨てる
 */

export const LAST_EPISODE_KEY = "novelai.lastEpisode";

export interface LastEpisode {
  root: string;
  path: string;
}

export function encodeLastEpisode(entry: LastEpisode): string {
  return JSON.stringify({ root: entry.root, path: entry.path });
}

/** 読めない・形の違うものは undefined（覚えていないのと同じ） */
export function parseLastEpisode(raw: string | null | undefined): LastEpisode | undefined {
  if (!raw) return undefined;
  try {
    const value = JSON.parse(raw) as unknown;
    if (typeof value !== "object" || value === null) return undefined;
    const { root, path } = value as Record<string, unknown>;
    if (typeof root !== "string" || typeof path !== "string" || !path.startsWith(`${root}/`)) return undefined;
    return { root, path };
  } catch {
    return undefined;
  }
}

/** ［書く］のタブの頭に置く札。題は話のファイルの名前、下に作品 */
export function renderLastEpisodeCard(entry: LastEpisode | undefined): string {
  if (!entry) return "";
  const name = entry.path.slice(entry.path.lastIndexOf("/") + 1).replace(/\.txt$/i, "");
  return (
    `<div class="work-list last-episode">` +
    `<button class="work-card" data-episode="${escapeHtml(entry.path)}" data-root="${escapeHtml(entry.root)}">` +
    `<span class="work-title">${escapeHtml(name)}</span>` +
    `<span class="work-meta"><span>${escapeHtml(entry.root)}</span></span>` +
    `</button></div>`
  );
}

export function readLastEpisode(storage: Pick<Storage, "getItem"> | undefined): LastEpisode | undefined {
  try {
    return parseLastEpisode(storage?.getItem(LAST_EPISODE_KEY));
  } catch {
    return undefined;
  }
}

export function rememberLastEpisode(storage: Pick<Storage, "setItem" | "getItem"> | undefined, entry: LastEpisode): void {
  try {
    storage?.setItem(LAST_EPISODE_KEY, encodeLastEpisode(entry));
    const recent = pushRecentEpisode(readRecentEpisodes(storage), entry);
    storage?.setItem(RECENT_EPISODES_KEY, JSON.stringify(recent));
  } catch {
    /* 覚えられなくても書くのは止めない */
  }
}

/* ---------- 最近開いた話（2026-11-18 作者「最後に開いた話と、最近開いた話を5つほど」） ---------- */

export const RECENT_EPISODES_KEY = "novelai.recentEpisodes";
/** 最後に開いた話のほかに並べる数 */
export const RECENT_LIMIT = 5;

/** 読めない・形の違うものは捨てる。新しい順 */
export function parseRecentEpisodes(raw: string | null | undefined): LastEpisode[] {
  if (!raw) return [];
  try {
    const value = JSON.parse(raw) as unknown;
    if (!Array.isArray(value)) return [];
    return value.map((item) => parseLastEpisode(JSON.stringify(item))).filter((item): item is LastEpisode => item !== undefined);
  } catch {
    return [];
  }
}

/** 開いた話を頭に足す（同じ話は前の所から外す）。最後に開いた話＋{@link RECENT_LIMIT} だけ残す */
export function pushRecentEpisode(list: readonly LastEpisode[], entry: LastEpisode): LastEpisode[] {
  const rest = list.filter((item) => !(item.root === entry.root && item.path === entry.path));
  return [{ root: entry.root, path: entry.path }, ...rest].slice(0, RECENT_LIMIT + 1);
}

export function readRecentEpisodes(storage: Pick<Storage, "getItem"> | undefined): LastEpisode[] {
  try {
    return parseRecentEpisodes(storage?.getItem(RECENT_EPISODES_KEY));
  } catch {
    return [];
  }
}

function episodeName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1).replace(/\.txt$/i, "");
}

/** ［書く］の頭：最後に開いた話の札と、その下に最近開いた話の行（最後に開いた話は除く） */
export function renderWriteLead(last: LastEpisode | undefined, recent: readonly LastEpisode[]): string {
  const others = recent.filter((item) => !(last && item.root === last.root && item.path === last.path)).slice(0, RECENT_LIMIT);
  const rows = others
    .map(
      (item) =>
        `<button class="ep" data-episode="${escapeHtml(item.path)}" data-root="${escapeHtml(item.root)}">` +
        `<span class="name">${escapeHtml(episodeName(item.path))}</span><span class="chars">${escapeHtml(item.root)}</span></button>`
    )
    .join("");
  const list = rows ? `<section class="menu-section recent-episodes"><h2>最近の話</h2><div class="ep-list">${rows}</div></section>` : "";
  return renderLastEpisodeCard(last) + list;
}
