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

/**
 * **欄の頭をなるべく見せたまま**、カーソルが見える範囲に入るようにページを送る量（正なら下へ）。
 * カーソルだけを見せると、縦書きの欄の頭が上の帯の裏に隠れたまま残った（2026-11-08 AQUOS wish3：
 * 欄を押すと、欄の上側が帯の裏へ送られた）。カーソルが見えたままでいられる分だけ、送りを戻す
 */
export function revealDelta(
  caret: { top: number; bottom: number },
  band: VisibleBand,
  margins: { top: number; bottom: number },
  keepTop?: number
): number {
  let delta = caretScrollDelta(caret, band, margins);
  if (keepTop === undefined) return delta;
  const visibleTop = band.top + margins.top;
  const visibleBottom = band.top + band.height - margins.bottom;
  const paneTop = keepTop - delta;
  if (paneTop < visibleTop) {
    const room = visibleBottom - (caret.bottom - delta);
    const back = Math.min(visibleTop - paneTop, Math.max(0, room));
    delta -= back;
  }
  return delta;
}

/** 上の帯（`.appbar`）の下の端。帯が無ければ 0 */
function appbarBottom(): number {
  const bar = document.querySelector(".appbar");
  if (!bar) return 0;
  const r = bar.getBoundingClientRect();
  return r.bottom > 0 ? r.bottom : 0;
}

/**
 * カーソルの印を見える所へ送る。`pane` を渡すと、その頭をなるべく見せたままにする。
 * 上の余白は、上の帯の下の端より下にする（帯の高さは機種で違う。AQUOS wish3 では 77 あった）
 */
export function revealCaret(caret: Pick<Element, "getBoundingClientRect"> | null, pane?: Element | null): void {
  if (!caret) return;
  const vv = window.visualViewport;
  const band = vv ? { top: vv.offsetTop, height: vv.height } : { top: 0, height: window.innerHeight };
  // 見える範囲が小さすぎるときは送らない（キーボードが出る途中で一瞬だけ縮む。AQUOS wish3 で 61 まで縮み、
  // そこでページを大きく送っていた）
  if (band.height < 160) return;
  const r = caret.getBoundingClientRect();
  const margins = { top: Math.max(64, appbarBottom() + 8), bottom: 48 };
  const delta = revealDelta(r, band, margins, pane ? pane.getBoundingClientRect().top : undefined);
  if (delta !== 0) window.scrollBy(0, delta);
}

/**
 * キーボードが出入りしたとき（見える範囲の大きさが変わったとき）に `onChange` を呼ぶ。外す関数を返す。
 * 大きさが落ち着いてから（0.15秒動かなくなってから）呼ぶ（出る途中の一瞬の大きさで送らない）
 */
export function watchVisibleBand(onChange: () => void): () => void {
  const vv = window.visualViewport;
  if (!vv) return () => undefined;
  let timer: number | undefined;
  const settled = () => {
    if (timer !== undefined) window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      timer = undefined;
      onChange();
    }, 150);
  };
  vv.addEventListener("resize", settled);
  return () => {
    vv.removeEventListener("resize", settled);
    if (timer !== undefined) window.clearTimeout(timer);
  };
}
