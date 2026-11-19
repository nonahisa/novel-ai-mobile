/**
 * **キーボードが出ているとき、一覧を指で送っても画面全体がずれないようにする**（2026-11-20 iPhone 17 シミュレーター 0.1.130：
 * 横向きでキーボードが出ているとき一覧を送ると、画面全体が上へずれ、上のバーの下に話の札と本文の上の行が潜り込んだ）。
 *
 * キーボードが出ていて見える所が低いとき（`compactMode.ts` の `data-compact`）は、原稿の画面を見えている高さに合わせてある。
 * それでも iOS はページを送れる（ページの高さはキーボードで変わらない）。一覧が短くて送れない（話が2つ）ときや、
 * 一覧の端まで送ったときは、指の動きがページへ渡り、ページが送られる（`overscroll-behavior: contain` は、送れる箱でないと効かない）。
 * そこで、見える所が低いあいだだけ、一覧がそれ以上送れない向きの指の動きをページへ渡さない（touchmove を止める）
 */

export interface ScrollBox {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

/**
 * 指が `dy` 動いた（下へ動かすと正。中身は上へ戻る向き）とき、箱がもう送れないか。送れないなら、ページへ渡さないために止める
 */
export function blocksTouchScroll(box: ScrollBox, dy: number): boolean {
  if (box.scrollHeight <= box.clientHeight + 1) return true;
  if (dy > 0) return box.scrollTop <= 0; // 指を下へ：頭まで戻っている
  if (dy < 0) return box.scrollTop + box.clientHeight >= box.scrollHeight - 1; // 指を上へ：末まで送っている
  return false;
}

/**
 * `boxes` の中で指を動かしたとき、`active()` が真のあいだだけ、箱がそれ以上送れない向きならページへ渡さない。外す関数を返す
 */
export function lockScrollChain(boxes: readonly HTMLElement[], active: () => boolean): () => void {
  let lastY: number | undefined;
  const onStart = (e: TouchEvent) => {
    lastY = e.touches.length === 1 ? e.touches[0]!.clientY : undefined;
  };
  const onMove = (e: TouchEvent) => {
    if (lastY === undefined || e.touches.length !== 1 || !active() || !e.cancelable) return;
    const y = e.touches[0]!.clientY;
    const dy = y - lastY;
    lastY = y;
    const box = boxes.find((b) => b.contains(e.target as Node));
    if (box && blocksTouchScroll(box, dy)) e.preventDefault();
  };
  for (const box of boxes) {
    box.addEventListener("touchstart", onStart, { passive: true });
    box.addEventListener("touchmove", onMove, { passive: false });
  }
  return () => {
    for (const box of boxes) {
      box.removeEventListener("touchstart", onStart);
      box.removeEventListener("touchmove", onMove);
    }
  };
}
