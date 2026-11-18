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

/**
 * **本文の字の大きさ**（設計書 5.2【決定】2026-10-29「文字の大きさは2本指で広げる・つまむ操作で変える。変えた大きさは端末ごとに覚える」）。
 * 既定は 16px（4.8）。12〜28px に収め、1px 刻み。CSS の変数 `--body-size` に置くので、書体と同じく見た目の案に関わらない
 */
export const BODY_SIZE_KEY = "novelai.bodySize";
export const DEFAULT_BODY_SIZE = 16;
export const MIN_BODY_SIZE = 12;
export const MAX_BODY_SIZE = 28;

export function clampBodySize(size: number): number {
  if (!Number.isFinite(size)) return DEFAULT_BODY_SIZE;
  return Math.min(MAX_BODY_SIZE, Math.max(MIN_BODY_SIZE, Math.round(size)));
}

export function readBodySize(storage: Pick<Storage, "getItem"> | undefined): number {
  try {
    const raw = storage?.getItem(BODY_SIZE_KEY);
    return raw ? clampBodySize(Number(raw)) : DEFAULT_BODY_SIZE;
  } catch {
    return DEFAULT_BODY_SIZE;
  }
}

export function writeBodySize(storage: Pick<Storage, "setItem"> | undefined, size: number): void {
  try {
    storage?.setItem(BODY_SIZE_KEY, String(clampBodySize(size)));
  } catch {
    /* 覚えられなくても、いまの画面は替わる */
  }
}

export function applyBodySize(root: HTMLElement, size: number): void {
  root.style.setProperty("--body-size", `${clampBodySize(size)}px`);
}

/** 2本指の開き具合から大きさを出す（始めの大きさ × いまの指の間 ÷ 始めの指の間） */
export function pinchedSize(startSize: number, startDistance: number, distance: number): number {
  if (startDistance <= 0) return clampBodySize(startSize);
  return clampBodySize((startSize * distance) / startDistance);
}
