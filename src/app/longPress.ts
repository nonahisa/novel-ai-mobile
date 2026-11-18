/**
 * **一覧の項目の長押し**（設計書 4.4「その場で出すもの：触っている所で絞った操作だけを、長押しか選んだときに出す」）。
 *
 * - 押したまま {@link HOLD_MS} 動かさなければ長押し。{@link MOVE_PX} より動いたら（一覧を送っている）やめる
 * - 長押しのあとに来る click は飲み込む（飲み込まないと、項目を開いてしまう）
 * - `contextmenu`（Android の長押し・マウスの右押し）も長押しとして扱う。端末のメニューは出さない
 * - 押したまま離さずにいても、時間が来たら出す（指を離すまで待たない。iOS の長押しと同じ）
 */

export const HOLD_MS = 500;
export const MOVE_PX = 10;

export function watchLongPress(root: HTMLElement, selector: string, onLong: (item: HTMLElement) => void): () => void {
  let timer: number | undefined;
  let start: { x: number; y: number } | undefined;
  let held: HTMLElement | undefined;
  let swallow = false;
  const cancel = () => {
    window.clearTimeout(timer);
    timer = undefined;
    held = undefined;
  };
  const fire = (item: HTMLElement) => {
    cancel();
    swallow = true;
    onLong(item);
  };
  const onDown = (e: PointerEvent) => {
    swallow = false;
    if (e.button > 0) return;
    const item = (e.target as HTMLElement).closest<HTMLElement>(selector);
    if (!item || !root.contains(item)) return;
    held = item;
    start = { x: e.clientX, y: e.clientY };
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      if (held) fire(held);
    }, HOLD_MS);
  };
  const onMove = (e: PointerEvent) => {
    if (timer === undefined || !start) return;
    if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > MOVE_PX) cancel();
  };
  const onClick = (e: MouseEvent) => {
    if (!swallow) return;
    swallow = false;
    e.stopImmediatePropagation();
    e.preventDefault();
  };
  const onContextMenu = (e: MouseEvent) => {
    const item = (e.target as HTMLElement).closest<HTMLElement>(selector);
    if (!item || !root.contains(item)) return;
    e.preventDefault();
    // 長押しの時計がもう出したなら、二度出さない
    if (timer === undefined && swallow) return;
    fire(item);
  };
  root.addEventListener("pointerdown", onDown, true);
  root.addEventListener("pointermove", onMove, true);
  root.addEventListener("pointerup", cancel, true);
  root.addEventListener("pointercancel", cancel, true);
  root.addEventListener("scroll", cancel, true);
  root.addEventListener("click", onClick, true);
  root.addEventListener("contextmenu", onContextMenu);
  return () => {
    cancel();
    root.removeEventListener("pointerdown", onDown, true);
    root.removeEventListener("pointermove", onMove, true);
    root.removeEventListener("pointerup", cancel, true);
    root.removeEventListener("pointercancel", cancel, true);
    root.removeEventListener("scroll", cancel, true);
    root.removeEventListener("click", onClick, true);
    root.removeEventListener("contextmenu", onContextMenu);
  };
}
