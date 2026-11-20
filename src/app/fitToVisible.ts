import { traceTouch } from "./textareaLongPress";

/**
 * **キーボードが出ているとき、一覧の下の端を見える所の下の端に合わせる**（2026-11-20 iPhone 17 シミュレーター 0.1.131：横向きで
 * キーボードが出ている間、一覧の末まで送っても第20話がキーボードの下に隠れたままで、見えも押せもしなかった。一覧の枠の下の端が
 * キーボードの下にあった）。
 *
 * 見える所が低いとき（`data-compact`）の一覧の高さは CSS で「見えている高さ − 細いバーの分」にしてあるが、それは一覧の頭が
 * 細いバーのすぐ下にあり、見える所がページの頭から始まるときだけ合う。iOS は、キーボードを出すとき見える所をページの途中へ
 * 動かすことがある（`visualViewport.offsetTop`）。そこで、一覧の頭の実際の位置と、見える所の下の端から高さを決める
 */
export function fittedHeight(boxTop: number, visibleTop: number, visibleHeight: number): number {
  return Math.max(MIN_FITTED_HEIGHT, Math.floor(visibleTop + visibleHeight - boxTop));
}
/** これより低くはしない（一覧の頭の札1つ分ほど） */
export const MIN_FITTED_HEIGHT = 80;

/** 見える所が低いあいだ（`active()`）、`box` の高さを見える所の下の端までにする。外れたら CSS へ戻す。外す関数を返す */
export function fitToVisible(box: HTMLElement, active: () => boolean): () => void {
  let frame = 0;
  const apply = () => {
    frame = 0;
    if (!active() || box.offsetParent === null) {
      if (box.style.height) box.style.removeProperty("height");
      return;
    }
    const vv = window.visualViewport;
    const visibleTop = vv ? vv.offsetTop : 0;
    const visibleHeight = vv ? vv.height : window.innerHeight;
    const top = box.getBoundingClientRect().top;
    const height = fittedHeight(top, visibleTop, visibleHeight);
    if (box.style.height !== `${height}px`) {
      box.style.height = `${height}px`;
      traceTouch(`side-fit top=${Math.round(top)} vvTop=${Math.round(visibleTop)} vvh=${Math.round(visibleHeight)} h=${height} scrollY=${Math.round(window.scrollY)}`);
    }
  };
  const schedule = () => {
    if (frame === 0) frame = requestAnimationFrame(apply);
  };
  apply();
  const vv = window.visualViewport;
  vv?.addEventListener("resize", schedule);
  vv?.addEventListener("scroll", schedule);
  window.addEventListener("resize", schedule);
  window.addEventListener("scroll", schedule, { passive: true });
  // `data-compact` は見える所の大きさで付け外しされる（`compactMode.ts`）。付け外しのあとにも合わせ直す
  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-compact", "data-kb-bare"] });
  return () => {
    cancelAnimationFrame(frame);
    observer.disconnect();
    vv?.removeEventListener("resize", schedule);
    vv?.removeEventListener("scroll", schedule);
    window.removeEventListener("resize", schedule);
    window.removeEventListener("scroll", schedule);
    box.style.removeProperty("height");
  };
}
