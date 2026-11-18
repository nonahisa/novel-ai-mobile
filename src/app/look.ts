import { escapeHtml } from "./menuScreen";

/**
 * **見た目の案を選ぶ**（設定 → 表示 → 見た目。2026-11-18 作者「選べるようにしてください」）。
 * 色・字・余白・札の形だけを替える（`src/looks.css`）。並びと動きは替えない。端末ごとに覚える（同期しない）。
 * **既定は白と藍**（2026-11-18 作者の答え「白と藍」。並べ写真を見てから）。まだ選んでいない人は白と藍で開く。
 * 選んだ人の見た目は替えない：標準を選んだら「標準」と覚える（0.1.90 までは標準を選ぶと覚えを消していたので、
 * そのころ標準を選んだ人は白と藍になる）
 */

/** まだ選んでいないときの見た目 */
export const DEFAULT_LOOK: LookId = "hakuai";

export type LookId = "standard" | "washi" | "hakuai" | "sumishu";

export const LOOKS: readonly { id: LookId; label: string; paper: string; accent: string }[] = [
  { id: "standard", label: "標準", paper: "#eceff4", accent: "#2c4a8c" },
  { id: "washi", label: "和紙と墨", paper: "#f3ede1", accent: "#2b2620" },
  { id: "hakuai", label: "白と藍", paper: "#ffffff", accent: "#2448a8" },
  { id: "sumishu", label: "墨と朱", paper: "#efefec", accent: "#a8402b" },
];

export const LOOK_KEY = "novelai.look";

export function parseLook(raw: string | null | undefined): LookId {
  return LOOKS.some((look) => look.id === raw) ? (raw as LookId) : DEFAULT_LOOK;
}

export function readLook(storage: Pick<Storage, "getItem"> | undefined): LookId {
  try {
    return parseLook(storage?.getItem(LOOK_KEY));
  } catch {
    return DEFAULT_LOOK;
  }
}

export function writeLook(storage: Pick<Storage, "setItem" | "removeItem"> | undefined, look: LookId): void {
  try {
    // 標準も覚える（覚えが無いと既定の白と藍で開くため）
    storage?.setItem(LOOK_KEY, look);
  } catch {
    /* 覚えられなくても、いまの画面は替わる */
  }
}

/** `<html>` に案の印を付ける。標準は印を付けない */
export function applyLook(root: HTMLElement, look: LookId): void {
  if (look === "standard") delete root.dataset.look;
  else root.dataset.look = look;
}

/** 表示の画面の「見た目」。4つの見本の色を押し口に載せる */
export function renderLookSection(current: LookId): string {
  const buttons = LOOKS.map(
    (look) =>
      `<button data-look-choice="${look.id}" aria-pressed="${look.id === current}">` +
      `<span class="look-swatch" style="--sw-paper:${look.paper};--sw-accent:${look.accent}" aria-hidden="true"><i></i><i></i></span>` +
      `${escapeHtml(look.label)}</button>`
  ).join("");
  return `<section class="menu-section"><h2>見た目</h2><div class="look-choice">${buttons}</div></section>`;
}
