import { mountMirror, syncMirrorScroll } from "./textareaLongPress";

/**
 * **左の線（既定の textarea）のカーソルの印を、こちらで描く**（iOS の手当て）。
 *
 * 2026-11-19 iPad mini 実機（Mac の B2・作者の画面写真 7:38）：縦書きの textarea で、字は正しい所に入るのに、
 * iPad が描くカーソル（横の短い青線）が1〜2字下のずれた所に出る（シミュレーターでは出ない）。縦書きの試しの A で
 * 同じことがあり、iOS の印を透明にしてこちらで描いて直した（引継ぎ書 36章。`editablePane.ts`）。それに倣う：
 *
 * - 範囲が無く（カーソルだけ）、欄に焦点があるときだけ描く。iOS の印は `caret-color: transparent` で隠す
 * - 位置は、textarea と同じ見た目の写しに「カーソルの前までの字 + 印の字（幅の無い空白）」を入れて読む。読んだらすぐ消す
 * - 縦書きは列を横切る短い線（字の幅）、横書きは行の高さの縦の線
 * - 描き直すのは、選びが変わったとき・打ったとき・送ったとき・大きさが変わったとき（次の描きの前に1回だけ）
 */
export function watchOwnCaret(area: HTMLTextAreaElement): () => void {
  const caret = document.createElement("div");
  caret.className = "own-caret textarea-caret";
  caret.setAttribute("aria-hidden", "true");
  caret.hidden = true;
  let frame = 0;

  const host = (): HTMLElement | null => area.parentElement;
  const hide = () => {
    caret.hidden = true;
    area.classList.remove("own-caret-shown");
  };
  const paint = () => {
    frame = 0;
    const parent = host();
    if (!parent || document.activeElement !== area || area.selectionStart !== area.selectionEnd) return hide();
    if (caret.parentElement !== parent) parent.appendChild(caret);
    if (getComputedStyle(parent).position === "static") parent.style.position = "relative";
    const offset = area.selectionStart;
    const mirror = mountMirror(area);
    const marker = document.createElement("span");
    marker.textContent = "​";
    mirror.append(area.value.slice(0, offset), marker, area.value.slice(offset));
    syncMirrorScroll(mirror, area);
    const m = marker.getBoundingClientRect();
    const vertical = getComputedStyle(area).writingMode.startsWith("vertical");
    const fontSize = parseFloat(getComputedStyle(area).fontSize) || 16;
    mirror.remove();
    const p = parent.getBoundingClientRect();
    const a = area.getBoundingClientRect();
    // 欄の外（送って見えない所）なら描かない
    const inside = m.right >= a.left - 1 && m.left <= a.right + 1 && m.bottom >= a.top - 1 && m.top <= a.bottom + 1;
    if (!inside) return hide();
    const left = m.left - p.left + parent.scrollLeft;
    const top = m.top - p.top + parent.scrollTop;
    if (vertical) {
      const width = Math.max(m.width, fontSize);
      const center = m.left + m.width / 2 - p.left + parent.scrollLeft;
      Object.assign(caret.style, { left: `${center - width / 2}px`, top: `${top}px`, width: `${width}px`, height: "2px" });
    } else {
      Object.assign(caret.style, { left: `${left}px`, top: `${top}px`, width: "2px", height: `${Math.max(m.height, fontSize)}px` });
    }
    caret.hidden = false;
    area.classList.add("own-caret-shown");
  };
  const refresh = () => {
    if (!frame) frame = requestAnimationFrame(paint);
  };
  const onSelectionChange = () => {
    if (document.activeElement === area) refresh();
  };
  const onBlur = () => {
    cancelAnimationFrame(frame);
    frame = 0;
    hide();
  };
  document.addEventListener("selectionchange", onSelectionChange);
  area.addEventListener("input", refresh);
  area.addEventListener("focus", refresh);
  area.addEventListener("blur", onBlur);
  area.addEventListener("scroll", refresh);
  area.addEventListener("keyup", refresh);
  area.addEventListener("pointerup", refresh);
  area.addEventListener("compositionupdate", refresh);
  area.addEventListener("compositionend", refresh);
  const resize = new ResizeObserver(refresh);
  resize.observe(area);
  window.visualViewport?.addEventListener("resize", refresh);
  return () => {
    cancelAnimationFrame(frame);
    resize.disconnect();
    document.removeEventListener("selectionchange", onSelectionChange);
    area.removeEventListener("input", refresh);
    area.removeEventListener("focus", refresh);
    area.removeEventListener("blur", onBlur);
    area.removeEventListener("scroll", refresh);
    area.removeEventListener("keyup", refresh);
    area.removeEventListener("pointerup", refresh);
    area.removeEventListener("compositionupdate", refresh);
    area.removeEventListener("compositionend", refresh);
    window.visualViewport?.removeEventListener("resize", refresh);
    area.classList.remove("own-caret-shown");
    caret.remove();
  };
}
