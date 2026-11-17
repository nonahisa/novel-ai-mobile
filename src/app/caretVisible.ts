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

/**
 * 上に張りつく帯の下の端（いちばん下のもの）。帯が無ければ 0。上のバー（`.appbar`）と、そのすぐ下に張りつく
 * 組んで書く面の道具の段（`#composedTools`）を数える（2026-11-17 AQUOS の試し11：道具の段を数えていなかったので、
 * カーソルが道具の段のすぐ下ぎりぎり、ときには裏に来た）
 */
function coveredTop(): number {
  let bottom = 0;
  for (const bar of Array.from(document.querySelectorAll(".appbar, #composedTools"))) {
    const r = bar.getBoundingClientRect();
    if (r.height > 0 && r.bottom > bottom) bottom = r.bottom;
  }
  return bottom;
}

/** 張りつく帯とカーソルの間に空ける幅（作者「もう少し下に出してほしい」2026-11-17。前は 8） */
const GAP_BELOW_BARS = 24;

/**
 * カーソルの印を見える所へ送る。`pane` を渡すと、その頭をなるべく見せたままにする。
 * 上の余白は、張りつく帯の下の端より少し下にする（帯の高さは機種で違う。AQUOS wish3 では 77 あった）
 */
export function revealCaret(caret: Pick<Element, "getBoundingClientRect"> | null, pane?: Element | null): void {
  if (!caret) return;
  const vv = window.visualViewport;
  const band = vv ? { top: vv.offsetTop, height: vv.height } : { top: 0, height: window.innerHeight };
  // 見える範囲が小さすぎるときは送らない（キーボードが出る途中で一瞬だけ縮む。AQUOS wish3 で 61 まで縮み、
  // そこでページを大きく送っていた）
  if (band.height < 160) return;
  const r = caret.getBoundingClientRect();
  const margins = { top: Math.max(64, coveredTop() + GAP_BELOW_BARS), bottom: 48 };
  const delta = revealDelta(r, band, margins, pane ? pane.getBoundingClientRect().top : undefined);
  if (delta !== 0) window.scrollBy(0, delta);
}

/**
 * **欄が見える範囲に入りきる高さなら、欄の下の端を見える範囲の下の端にそろえる**送りの量（正なら下へ）。入りきらなければ undefined。
 * キーボードが出て見える所が低いとき（`compactMode`）、組んで書く面（C）の欄は「見える高さ − 細いバー − 道具の段」の高さにしてある。
 * カーソルの所までしか送らないと、欄の下の端がキーボードの裏に、上の説明の行がバーと道具の段のあいだに半端に残った
 * （2026-11-17 iPad Air 11インチのシミュレーター 0.1.81：欄の下 約23pt がキーボードの裏）
 */
export function fitPaneDelta(pane: { top: number; bottom: number }, band: VisibleBand): number | undefined {
  if (pane.bottom - pane.top > band.height + 1) return undefined;
  return pane.bottom - (band.top + band.height);
}

/** 欄が入りきるなら、欄の下の端を見える範囲の下の端にそろえる。そろえたら true */
export function fitPane(pane: Element): boolean {
  const vv = window.visualViewport;
  const band = vv ? { top: vv.offsetTop, height: vv.height } : { top: 0, height: window.innerHeight };
  if (band.height < 160) return false;
  const delta = fitPaneDelta(pane.getBoundingClientRect(), band);
  if (delta === undefined) return false;
  if (Math.abs(delta) >= 1) window.scrollBy(0, delta);
  return true;
}

/** キーボードが出入りしたあと、ブラウザが自分でページを送るのを待つ間（AQUOS では 80ms ほどあとに2回送った） */
const FOLLOW_MS = 600;
/** ブラウザの送りが止まったと見なす間 */
const SCROLL_SETTLE_MS = 120;

/**
 * キーボードが出入りしたとき（見える範囲の大きさが変わったとき）に `onChange` を呼ぶ。外す関数を返す。
 * 大きさが落ち着いてから（0.15秒動かなくなってから）呼ぶ（出る途中の一瞬の大きさで送らない）。
 *
 * **そのあとブラウザが自分でページを送ったら、送りが止まってからもう一度呼ぶ**（2026-11-17 AQUOS の試し11：
 * こちらが送った 80ms ほどあとに、ブラウザが「焦点の欄を見える所へ」ページを送り、縦書きの列の頭の字が道具の段の
 * すぐ下に残った）。見るのは呼んでから {@link FOLLOW_MS} の間だけ（そのあとの送りは作者の指なので、追わない）
 */
export function watchVisibleBand(onChange: () => void): () => void {
  const vv = window.visualViewport;
  if (!vv) return () => undefined;
  let timer: number | undefined;
  let scrollTimer: number | undefined;
  let followTimer: number | undefined;
  let following = false;
  const call = () => {
    onChange();
    following = true;
    if (followTimer !== undefined) window.clearTimeout(followTimer);
    followTimer = window.setTimeout(() => {
      following = false;
      followTimer = undefined;
    }, FOLLOW_MS);
  };
  const settled = () => {
    if (timer !== undefined) window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      timer = undefined;
      call();
    }, 150);
  };
  const scrolled = () => {
    if (!following) return;
    if (scrollTimer !== undefined) window.clearTimeout(scrollTimer);
    scrollTimer = window.setTimeout(() => {
      scrollTimer = undefined;
      // 送り直しで起きた送りは追わない（1回で足りる。追うと自分の送りを追い続ける）
      following = false;
      onChange();
    }, SCROLL_SETTLE_MS);
  };
  vv.addEventListener("resize", settled);
  window.addEventListener("scroll", scrolled, { passive: true });
  return () => {
    vv.removeEventListener("resize", settled);
    window.removeEventListener("scroll", scrolled);
    for (const id of [timer, scrollTimer, followTimer]) if (id !== undefined) window.clearTimeout(id);
  };
}
