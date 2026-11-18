/**
 * **本文の書体**（設定 → 表示 → 本文の書体。原稿エディターの欄）。
 *
 * 【決定】2026-11-18 作者の答え「案3 なろう寄り」：**既定はゴシック・16px・行間1.8**（小説家になろうの既定に寄せた）。
 * ［表示］で明朝とゴシックを切り替えられる（明朝は今までどおり取り寄せ。取り寄せていない Android では、明朝を選んでも
 * 端末のゴシックで出る）。見た目の案（4つ）には関わらない：見た目は色と札の形だけを替え、本文の書体は `<html data-body-font>`
 * と CSS の変数（`--font-body`）で決める。端末ごとに覚える（同期しない）
 */

export type BodyFont = "gothic" | "mincho";

export const BODY_FONT_KEY = "novelai.bodyFont";
export const DEFAULT_BODY_FONT: BodyFont = "gothic";

export function parseBodyFont(raw: string | null | undefined): BodyFont {
  return raw === "mincho" || raw === "gothic" ? raw : DEFAULT_BODY_FONT;
}

export function readBodyFont(storage: Pick<Storage, "getItem"> | undefined): BodyFont {
  try {
    return parseBodyFont(storage?.getItem(BODY_FONT_KEY));
  } catch {
    return DEFAULT_BODY_FONT;
  }
}

export function writeBodyFont(storage: Pick<Storage, "setItem"> | undefined, font: BodyFont): void {
  try {
    storage?.setItem(BODY_FONT_KEY, font);
  } catch {
    /* 覚えられなくても、いまの画面は替わる */
  }
}

export function applyBodyFont(root: HTMLElement, font: BodyFont): void {
  root.dataset.bodyFont = font;
}

export function renderBodyFontSection(current: BodyFont): string {
  const button = (font: BodyFont, label: string) => `<button data-body-font="${font}" aria-pressed="${current === font}">${label}</button>`;
  return `<section class="menu-section"><h2>本文の書体</h2><div class="seg body-font-choice">${button("gothic", "ゴシック")}${button("mincho", "明朝")}</div></section>`;
}
