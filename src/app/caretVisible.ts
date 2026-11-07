/**
 * **キーボードが出ても、カーソルのある所を見える位置へ送る**（2026-11-07 Mac の iOS シミュレーター：
 * キーボードが出ると縦書きの欄がその下に隠れ、手で送る必要があった。実機確認リスト「キーボードが出たとき、
 * カーソルの行が見えるか」）。
 *
 * B（右傍線）の欄はこの画面が字を描くので、ブラウザは「カーソルを見える所へ」をしてくれない。
 * 見えている範囲は `visualViewport`（キーボードの分だけ縮む。iOS ではページの大きさは変わらない）で測り、
 * カーソルの印がその外にあれば、ページを送る。上は上のバーの分、下は少しの余白を空ける。
 */

export interface VisibleBand {
  /** 見えている範囲の上の端（ページの窓の頭からの位置） */
  top: number;
  /** 見えている範囲の高さ */
  height: number;
}

/** カーソルの印の上下（ページの窓の頭からの位置）が見える範囲に入るよう、ページを送る量（正なら下へ） */
export function caretScrollDelta(
  caret: { top: number; bottom: number },
  band: VisibleBand,
  margins: { top: number; bottom: number } = { top: 64, bottom: 48 }
): number {
  const visibleTop = band.top + margins.top;
  const visibleBottom = band.top + band.height - margins.bottom;
  if (caret.bottom > visibleBottom) return caret.bottom - visibleBottom;
  if (caret.top < visibleTop) return caret.top - visibleTop;
  return 0;
}

/** カーソルの印を見える所へ送る */
export function revealCaret(caret: Element | null): void {
  if (!caret) return;
  const vv = window.visualViewport;
  const band = vv ? { top: vv.offsetTop, height: vv.height } : { top: 0, height: window.innerHeight };
  const r = caret.getBoundingClientRect();
  const delta = caretScrollDelta(r, band);
  if (delta !== 0) window.scrollBy(0, delta);
}

/**
 * キーボードが出入りしたとき（見える範囲の大きさが変わったとき）に `onChange` を呼ぶ。外す関数を返す
 */
export function watchVisibleBand(onChange: () => void): () => void {
  const vv = window.visualViewport;
  if (!vv) return () => undefined;
  vv.addEventListener("resize", onChange);
  return () => vv.removeEventListener("resize", onChange);
}
