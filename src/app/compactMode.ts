/**
 * **キーボードが出て見える所が低いときは、上下を細くする**（2026-11-17 作者の答え。直しの案1）。
 *
 * iPad mini を横にしてキーボードを出すと、見える高さは約317pt で、本文の枠は約130pt・1列約7字しか無かった
 * （Mac の写真、0.1.74）。キーボードの大きさは端末が決めるので、アプリの側を細くする：
 * - 上のバーを細くし、副題（保存済み など）を隠す（CSS の `:root[data-compact]`）
 * - 原稿の欄の下限をやめ、見えている高さ（`--vvh`）に合わせる。道具帯はキーボードのすぐ上に来る
 *
 * 細くするのは「横長で、見える高さが {@link COMPACT_MAX_HEIGHT} より低い」ときだけ。縦長のスマホ
 * （AQUOS の縦＋キーボードは 320×368）はいまのまま（そちらは試し11で確かめた並び）。
 */
export const COMPACT_MAX_HEIGHT = 480;

export function isCompact(width: number, height: number): boolean {
  return height < COMPACT_MAX_HEIGHT && width > height;
}

/** 見える所が変わるたびに、`root` に印と見える高さを付ける。外す関数を返す */
export function watchCompact(win: Window, root: HTMLElement): () => void {
  const apply = () => {
    const vv = win.visualViewport;
    const width = vv ? vv.width : win.innerWidth;
    const height = vv ? vv.height : win.innerHeight;
    root.style.setProperty("--vvh", `${Math.round(height)}px`);
    if (isCompact(width, height)) root.dataset.compact = "on";
    else delete root.dataset.compact;
  };
  apply();
  const target: EventTarget = win.visualViewport ?? win;
  target.addEventListener("resize", apply);
  return () => target.removeEventListener("resize", apply);
}
