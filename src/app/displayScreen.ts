import { escapeHtml } from "./menuScreen";
import { MINCHO_FONT, sizeLabel } from "../platform/fontDownload";

/**
 * **表示**（［ほか］→ 設定 → 表示。`#/display`。設計書 4.2 の H「表示（書体・文字の大きさ・縦横の既定）」のうち書体。
 * 引継ぎ書 68章）。明朝を取り寄せる。**取り寄せる前に大きさを示し、押したときだけ落とす**（設計書 5.2）
 */

export type FontView =
  | { kind: "checking" }
  | { kind: "absent"; failure?: string }
  | { kind: "downloading"; percent: number }
  | { kind: "installed" };

export function renderFontRow(view: FontView): string {
  const name = `<span class="name">${escapeHtml(MINCHO_FONT.label)}</span>`;
  switch (view.kind) {
    case "checking":
      return `<div class="font-row" aria-busy="true">${name}</div>`;
    case "absent": {
      const failure = view.failure ? `<span class="flag warn">${escapeHtml(view.failure)}</span>` : "";
      return `<div class="font-row">${name}${failure}<button data-font="get">${escapeHtml(`取り寄せる（${sizeLabel(MINCHO_FONT.size)}）`)}</button></div>`;
    }
    case "downloading":
      return `<div class="font-row" aria-busy="true">${name}<span class="font-progress" role="status">${view.percent}%</span><button data-font="stop">やめる</button></div>`;
    case "installed":
      return `<div class="font-row">${name}<span class="flag ok">使っています</span><button data-font="remove">消す</button></div>`;
  }
}

export function renderDisplayScreen(view: FontView): string {
  return `<section class="menu-section"><h2>書体</h2><div id="fontSlot">${renderFontRow(view)}</div></section>`;
}

export const FONT_FAILURE = {
  mismatch: "届いた中身が違うので使いません",
  failed: "取り寄せられませんでした",
} as const;

/** ライセンス（［ほか］→ ヘルプ → ライセンス。`#/licenses`）。取り寄せる書体の許諾の全文を出す */
export function renderLicenses(text: string | undefined): string {
  return (
    `<section class="menu-section"><h2>${escapeHtml(MINCHO_FONT.label)}</h2>` +
    `<p class="license-meta">${escapeHtml(`${MINCHO_FONT.license}・notofonts/noto-cjk ${MINCHO_FONT.version}`)}</p>` +
    `<pre class="license-text">${escapeHtml(text ?? "")}</pre></section>`
  );
}

/**
 * 変換中の線（縦書きで、変換中の字に引く線を行の左に出すか右に出すか。引継ぎ書 76章）。既定は左。
 * 右はテスト中（範囲を選べない・道具帯のルビと傍点は選んだ字に振れない）と、選べる所に書く
 */
export function renderLineSection(line: "left" | "right", leftColors = false): string {
  const button = (value: "left" | "right", label: string) => `<button data-line="${value}" aria-pressed="${line === value}">${label}</button>`;
  const color = (on: boolean, label: string) => `<button data-term-colors="${on ? "on" : "off"}" aria-pressed="${leftColors === on}">${label}</button>`;
  return (
    `<section class="menu-section"><h2>変換中の線</h2><div class="seg line-choice">${button("left", "左")}${button("right", "右（テスト中）")}</div>` +
    (line === "right" ? `<p class="flag warn long">テスト中：コピー・切り取り・貼り付けはまだできません</p>` : "") +
    `</section>` +
    // 右の線の欄はもともと用語に色が付く。左の線の欄に色を付けるかだけを選ぶ（2026-11-17 作者の答え。引継ぎ書 87章）
    (line === "left"
      ? `<section class="menu-section"><h2>用語の色</h2><div class="seg term-color-choice">${color(false, "付けない")}${color(true, "付ける（テスト中）")}</div></section>`
      : "")
  );
}
