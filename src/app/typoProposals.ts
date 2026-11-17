import { escapeHtml } from "./menuScreen";
import type { TypoFinding } from "../platform/typoCheck";

/**
 * **提案（画面 D）の誤字脱字**（段2。設計書 7章「結果はすべて提案へ。作者が採ったものだけを当てる」）。
 *
 * 置き場は端末（`localStorage`）。作品フォルダー（`.aiwriter/`）には書かない：本体が読む形の取り決めがまだ無く、
 * 本体の提案の一覧と取り違えないため（本体の「見送った指摘」の控えは vscode に頼る所にあり、借りられない）。
 * 採ると本文へ当てて一覧から消える。見送ると消える。同じ所を同じ形に直す指摘は重ねない
 */

export const PROPOSALS_KEY = "novelai.proposals.typo";

export interface TypoProposal extends TypoFinding {
  /** 作品（置き場の根から） */
  root: string;
  id: string;
}

export function proposalId(finding: Pick<TypoFinding, "path" | "line" | "target" | "suggestion">): string {
  return `${finding.path}#${finding.line}#${finding.target}→${finding.suggestion}`;
}

export function parseProposals(raw: string | null | undefined): TypoProposal[] {
  if (!raw) return [];
  try {
    const value = JSON.parse(raw) as unknown;
    if (!Array.isArray(value)) return [];
    return value.filter(
      (item): item is TypoProposal =>
        typeof item === "object" &&
        item !== null &&
        ["root", "id", "path", "original", "target", "suggestion", "reason", "confidence"].every((key) => typeof (item as Record<string, unknown>)[key] === "string") &&
        Number.isInteger((item as Record<string, unknown>).line)
    );
  } catch {
    return [];
  }
}

/** 一話を走らせ直したら、その話の前の指摘は入れ替える（古い指摘は本文と合わなくなっていることがある） */
export function replaceEpisodeProposals(list: readonly TypoProposal[], root: string, path: string, findings: readonly TypoFinding[]): TypoProposal[] {
  const kept = list.filter((item) => item.path !== path);
  const seen = new Set<string>();
  const fresh: TypoProposal[] = [];
  for (const finding of findings) {
    const id = proposalId(finding);
    if (seen.has(id)) continue;
    seen.add(id);
    fresh.push({ ...finding, root, id });
  }
  return [...kept, ...fresh];
}

/** 前の指摘を消さずに足す（同じ指摘は重ねない） */
export function addProposals(list: readonly TypoProposal[], root: string, findings: readonly TypoFinding[]): TypoProposal[] {
  const seen = new Set(list.map((item) => item.id));
  const out = [...list];
  for (const finding of findings) {
    const id = proposalId(finding);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ ...finding, root, id });
  }
  return out;
}

export function withoutProposal(list: readonly TypoProposal[], id: string): TypoProposal[] {
  return list.filter((item) => item.id !== id);
}

export function readProposals(storage: Pick<Storage, "getItem"> | undefined): TypoProposal[] {
  try {
    return parseProposals(storage?.getItem(PROPOSALS_KEY));
  } catch {
    return [];
  }
}

export function writeProposals(storage: Pick<Storage, "setItem"> | undefined, list: readonly TypoProposal[]): void {
  try {
    storage?.setItem(PROPOSALS_KEY, JSON.stringify(list));
  } catch {
    /* 覚えられなくても、いまの画面には出る */
  }
}

function episodeName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1).replace(/\.txt$/i, "");
}

/** 直す所を元の行の中で示す（直す字だけ印を付ける） */
function markTarget(original: string, target: string): string {
  const at = original.indexOf(target);
  if (at < 0) return escapeHtml(original);
  return `${escapeHtml(original.slice(0, at))}<mark>${escapeHtml(target)}</mark>${escapeHtml(original.slice(at + target.length))}`;
}

/** ［提案］のタブの誤字脱字。話ごとに束ね、1件ごとに［採る］［見送る］ */
export function renderProposals(list: readonly TypoProposal[]): string {
  if (list.length === 0) return `<div class="proposal-list"><div class="work-empty" aria-hidden="true"></div></div>`;
  const byEpisode = new Map<string, TypoProposal[]>();
  for (const item of list) byEpisode.set(item.path, [...(byEpisode.get(item.path) ?? []), item]);
  const groups = [...byEpisode.entries()].map(([path, items]) => {
    const rows = items
      .sort((a, b) => a.line - b.line)
      .map(
        (item) =>
          `<li class="proposal" data-proposal="${escapeHtml(item.id)}">` +
          `<p class="proposal-line">${markTarget(item.original, item.target)}</p>` +
          `<p class="proposal-fix"><span class="proposal-from">${escapeHtml(item.target)}</span> → <span class="proposal-to">${escapeHtml(item.suggestion)}</span></p>` +
          `<p class="proposal-why">${escapeHtml(`${item.line}行・${item.reason}`)}</p>` +
          `<div class="proposal-actions"><button class="ghost" data-dismiss="${escapeHtml(item.id)}">見送る</button><button data-accept="${escapeHtml(item.id)}">採る</button></div>` +
          `</li>`
      )
      .join("");
    return `<section class="menu-section proposal-group"><h2>${escapeHtml(`${episodeName(path)}・${items.length}件`)}</h2><ol class="proposal-list">${rows}</ol></section>`;
  });
  return groups.join("");
}

/** ［提案］の頭：最後に開いた話で誤字脱字を走らせる入口（入口は仮。並べ方の案と一緒に作者に見てもらう） */
export function renderTypoEntry(last: { root: string; path: string } | undefined): string {
  if (!last) return "";
  return (
    `<section class="menu-section typo-entry"><h2>AI で見る</h2><div class="menu-items">` +
    `<button class="menu-item built" data-typo-path="${escapeHtml(last.path)}" data-typo-root="${escapeHtml(last.root)}">` +
    `誤字脱字<span class="menu-note">${escapeHtml(episodeName(last.path))}</span></button></div></section>`
  );
}
