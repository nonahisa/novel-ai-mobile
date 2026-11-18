import { applyBodySize, pinchedSize, readBodySize, writeBodySize } from "./bodyFont";

/**
 * 原稿の欄の上の2本指の広げる・つまむで、本文の字の大きさを変える（設計書 5.2）。1本指の動き（送る・カーソル・選ぶ）には触らない。
 * 2本指で動かしているあいだは、ページの拡大を止める（欄の字だけを大きくする）。指を離したら端末に覚える
 */
export function watchPinchSize(target: HTMLElement, root: HTMLElement = document.documentElement): () => void {
  let start: { size: number; distance: number } | undefined;
  let size = readBodySize(globalThis.localStorage);
  const distanceOf = (touches: TouchList) => Math.hypot(touches[0]!.clientX - touches[1]!.clientX, touches[0]!.clientY - touches[1]!.clientY);
  const onStart = (e: TouchEvent) => {
    if (e.touches.length !== 2) return;
    start = { size, distance: distanceOf(e.touches) };
  };
  const onMove = (e: TouchEvent) => {
    if (!start || e.touches.length !== 2) return;
    e.preventDefault();
    const next = pinchedSize(start.size, start.distance, distanceOf(e.touches));
    if (next === size) return;
    size = next;
    applyBodySize(root, size);
  };
  const onEnd = (e: TouchEvent) => {
    if (!start || e.touches.length >= 2) return;
    start = undefined;
    writeBodySize(globalThis.localStorage, size);
  };
  target.addEventListener("touchstart", onStart, { passive: true });
  target.addEventListener("touchmove", onMove, { passive: false });
  target.addEventListener("touchend", onEnd, { passive: true });
  target.addEventListener("touchcancel", onEnd, { passive: true });
  return () => {
    target.removeEventListener("touchstart", onStart);
    target.removeEventListener("touchmove", onMove);
    target.removeEventListener("touchend", onEnd);
    target.removeEventListener("touchcancel", onEnd);
  };
}
