import { caretScrollDelta, revealCaret, watchVisibleBand } from "./caretVisible";
import type { TermFinder } from "./editContextPane";
import {
  type EditableChildKind,
  type EditableSegment,
  caretPlacement,
  plainValue,
  stripSupport,
  LINE_SUPPORT,
  clampCaretToPane,
  isPlainShape,
  locateOffset,
  replaceRange,
  segmentsText,
} from "./editableText";
import { TERM_KINDS } from "./termHighlight";

/**
 * **A（いまの形）の入力欄を contenteditable で作る**（作者の答え 2026-11-07「両方」。用語の色付けのため）。
 *
 * 入力はブラウザのまま（変換中の線・候補の窓・カーソル・選択もブラウザが描く。縦書きでは線は左）。
 * textarea から替えたのは、**中の字に色を付けるため**だけ。色は本体の原稿エディターと同じく
 * **CSS Custom Highlight API** で置き、DOM は書き換えない（書き換えると変換中の字とカーソルが飛ぶ）。
 *
 * - `contenteditable="plaintext-only"`（太字などの飾りを入れない）。使えなければ `true`
 * - 欄の中身は**いつも素直な形**（字の節1つ。本文が改行で終わるなら、うしろに支えの `<br>`）に保つ。
 *   Enter はこちらで本文に `\n` を入れて作り直す。打ったあとに形が崩れていたら（iOS の ⌫ が空の要素を
 *   残したなど）、**変換していないときに**本文から作り直し、カーソルを同じ字の位置へ戻す
 *   （2026-11-07 Mac G2a・G3。`editableText.ts` の `isPlainShape`・`caretPlacement`）
 * - Enter のあとはページも欄も自分で送る（カーソルが見える所へ。ブラウザに任せると、iOS ではページが
 *   保存のボタンのあたりへ飛び、欄も横へ送られた）
 * - 色は1コマに1回まとめて置き直す（打鍵のたびに範囲を作り直さない）
 * - 色付けの仕組みが無い WebView では、色が出ないだけで入力は動く
 */
export interface EditablePane {
  getText(): string;
  setText(text: string): void;
  setTerms(find: TermFinder): void;
  /** Enter をブラウザに任せるか（試しの画面で比べる。iOS の印の確かめ） */
  setNativeEnter(native: boolean): void;
  destroy(): void;
}

/** 欄（または写し）の中の、字の節と改行の並び。`ignoreTrailingBreak` なら欄のいちばん後ろの支えの <br> を数えない */
function collectSegments(root: Node, ignoreTrailingBreak = true): EditableSegment<Node>[] {
  const out: EditableSegment<Node>[] = [];
  let soFar = "";
  const push = (segment: EditableSegment<Node>) => {
    out.push(segment);
    soFar += segment.kind === "text" ? segment.text : "\n";
  };
  const walk = (node: Node) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        push({ kind: "text", node: child, text: stripSupport(child.nodeValue ?? "") });
      } else if (child.nodeName === "BR") {
        if (!(ignoreTrailingBreak && child.parentNode === root && child === root.lastChild)) push({ kind: "newline", node: child });
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        const block = child.nodeName === "DIV" || child.nodeName === "P";
        if (block && soFar !== "" && !soFar.endsWith("\n")) push({ kind: "newline", node: child });
        walk(child);
      }
    }
  };
  walk(root);
  return out;
}

function childKinds(element: HTMLElement): EditableChildKind[] {
  return Array.from(element.childNodes).map((n) => (n.nodeType === Node.TEXT_NODE ? "text" : n.nodeName === "BR" ? "br" : "other"));
}

export function mountEditablePane(
  element: HTMLElement,
  text: string,
  onChange: (text: string) => void,
  log: (line: string) => void = () => undefined
): EditablePane {
  try {
    element.contentEditable = "plaintext-only";
  } catch {
    element.contentEditable = "true";
  }
  if (element.contentEditable !== "plaintext-only") element.contentEditable = "true";
  element.setAttribute("role", "textbox");
  element.setAttribute("aria-multiline", "true");
  element.spellcheck = false;
  element.setAttribute("autocapitalize", "off");
  element.setAttribute("autocorrect", "off");

  let findTerms: TermFinder = () => [];
  let current = text;
  let composing = false;
  const highlightsUsable = typeof CSS !== "undefined" && "highlights" in CSS && typeof Highlight !== "undefined";

  /** 欄を素直な形で書き直す */
  const write = (next: string) => {
    element.textContent = plainValue(next);
    current = next;
  };

  /** 欄の頭から (container, offset) までの字の数 */
  const offsetOf = (container: Node, offset: number): number => {
    const range = document.createRange();
    range.setStart(element, 0);
    range.setEnd(container, offset);
    const holder = document.createElement("div");
    holder.appendChild(range.cloneContents());
    return segmentsText(collectSegments(holder, false)).length;
  };
  /** いまの選択（本文の字の位置）。欄の外なら undefined */
  const selectionOffsets = (): { start: number; end: number } | undefined => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return undefined;
    const range = selection.getRangeAt(0);
    if (!element.contains(range.startContainer) || !element.contains(range.endContainer)) return undefined;
    return { start: offsetOf(range.startContainer, range.startOffset), end: offsetOf(range.endContainer, range.endOffset) };
  };
  /** 素直な形の欄で、本文の offset 字目にカーソルを置く */
  const placeCaret = (offset: number) => {
    const selection = window.getSelection();
    if (!selection) return;
    const range = document.createRange();
    const at = caretPlacement(current, offset);
    const textNode = element.firstChild;
    // 最後の空の行でも、字の節の中（支えの字の前）に置く（`editableText.ts` の LINE_SUPPORT）
    if (textNode && textNode.nodeType === Node.TEXT_NODE) range.setStart(textNode, at.offset);
    else range.setStart(element, 0);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
  };

  /**
   * カーソルの位置を測る。大きさ0で返ったとき（iOS は最後の空の列のカーソルを 0〜0 と返す。2026-11-07 Mac
   * #20 K2）は、**見えない字の印をカーソルの所に一時的に置いて測り**、すぐ外して欄を素直な形に戻す
   */
  const measureCaret = (offset: number): DOMRect | undefined => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return undefined;
    const rect = selection.getRangeAt(0).getBoundingClientRect();
    if (rect.width > 0 || rect.height > 0) return rect;
    const marker = document.createElement("span");
    marker.textContent = "​";
    selection.getRangeAt(0).insertNode(marker);
    const measured = marker.getBoundingClientRect();
    marker.remove();
    element.normalize();
    placeCaret(offset);
    return measured.width > 0 || measured.height > 0 ? measured : undefined;
  };

  /**
   * **ブラウザが描かないカーソルの印を、こちらで描く**（2026-11-07 Mac #20〜#25：iOS のシミュレーターでは、
   * 縦書きの最後の空の列のカーソルを、支えが `<br>` でも見えない字でも、Enter をブラウザに任せても描かず、
   * 位置も 0〜0 で返した。字を打てば描かれる）。
   * ブラウザがカーソルの位置を 0〜0 と返したときだけ、見えない字の印で測った所に、点滅する印を重ねる
   * （Android はふつうに描くので出ない）。打つ・押す・カーソルが動く・焦点が外れると消す
   */
  let ownCaret: HTMLElement | undefined;
  let ownState: { offset: number; x: number; y: number; bx: number; by: number; sl: number; st: number } | undefined;
  const placeOwnCaret = () => {
    if (!ownCaret || !ownState) return;
    const box = element.getBoundingClientRect();
    const x = box.left + (ownState.x - ownState.bx) - (element.scrollLeft - ownState.sl);
    const y = box.top + (ownState.y - ownState.by) - (element.scrollTop - ownState.st);
    ownCaret.style.left = `${x}px`;
    ownCaret.style.top = `${y}px`;
  };
  const hideOwnCaret = () => {
    ownCaret?.remove();
    ownCaret = undefined;
    ownState = undefined;
  };
  const showOwnCaret = (at: DOMRect, offset: number) => {
    hideOwnCaret();
    const vertical = element.classList.contains("vertical");
    const lineHeight = parseFloat(getComputedStyle(element).fontSize) || 20;
    const box = element.getBoundingClientRect();
    ownCaret = document.createElement("div");
    ownCaret.className = "own-caret";
    ownCaret.setAttribute("aria-hidden", "true");
    // 縦書きは横の棒（列の太さ）、横書きは縦の棒（行の高さ）
    ownCaret.style.width = vertical ? `${Math.max(at.width, lineHeight)}px` : "2px";
    ownCaret.style.height = vertical ? "2px" : `${Math.max(at.height, lineHeight)}px`;
    ownState = {
      offset,
      x: vertical ? at.left : at.left - 1,
      y: vertical ? at.top - 1 : at.top,
      bx: box.left,
      by: box.top,
      sl: element.scrollLeft,
      st: element.scrollTop,
    };
    document.body.appendChild(ownCaret);
    placeOwnCaret();
    log("A カーソルの印をこちらで描いた（ブラウザが位置を 0〜0 と返したため）");
  };

  /**
   * カーソルを、欄の中でもページでも見える所へ送る（縦書きは欄を横へ、横書きは欄を縦へ。そのあとページ）。
   * **測れなかったら何も送らない**（0〜0 のまま送ると、欄が右へずれ、ページが下へ送られた。2026-11-07 Mac #20 K2）
   */
  const revealSelection = (offset: number) => {
    const rect = measureCaret(offset);
    if (!rect) {
      log("A カーソルの位置が測れなかったので、送らなかった");
      return;
    }
    const box = element.getBoundingClientRect();
    const vertical = element.classList.contains("vertical");
    if (vertical) {
      const margin = 24;
      if (rect.left < box.left + margin) element.scrollLeft -= box.left + margin - rect.left;
      else if (rect.right > box.right - margin) element.scrollLeft += rect.right - (box.right - margin);
    } else {
      const delta = caretScrollDelta(rect, { top: box.top, height: box.height }, { top: 8, bottom: 8 });
      if (delta !== 0) element.scrollTop += delta;
    }
    // ページは、欄の中に収めたカーソルの位置で送る（`clampCaretToPane`）
    const after = element.getBoundingClientRect();
    const moved = measureCaret(offset) ?? rect;
    const caret = clampCaretToPane(moved, after, vertical);
    log(`A Enter のあとのカーソル（上下 ${Math.round(moved.top)}〜${Math.round(moved.bottom)}、左右 ${Math.round(moved.left)}〜${Math.round(moved.right)}、欄 ${Math.round(after.top)}〜${Math.round(after.bottom)}）`);
    revealCaret({ getBoundingClientRect: () => caret as DOMRect }, element);
    // ブラウザがカーソルの位置を測れない（＝描いていない）なら、こちらで印を描く
    const selection = window.getSelection();
    const real = selection && selection.rangeCount > 0 ? selection.getRangeAt(0).getBoundingClientRect() : undefined;
    if (real && real.width === 0 && real.height === 0) {
      const now = measureCaret(offset);
      if (now) showOwnCaret(now, offset);
    }
  };

  const clearHighlights = () => {
    if (!highlightsUsable) return;
    for (const kind of TERM_KINDS) CSS.highlights.delete(`term-${kind}`);
  };
  const applyHighlights = () => {
    if (!highlightsUsable) return;
    try {
      const segments = collectSegments(element);
      const body = segmentsText(segments);
      const buckets = new Map<string, Range[]>(TERM_KINDS.map((k) => [k, []]));
      for (const span of findTerms(body)) {
        const head = locateOffset(segments, span.start, "start");
        const tail = locateOffset(segments, span.end, "end");
        if (!head || !tail) continue;
        const range = document.createRange();
        range.setStart(head.node, head.offset);
        range.setEnd(tail.node, tail.offset);
        buckets.get(span.kind)?.push(range);
      }
      for (const [kind, ranges] of buckets) {
        if (ranges.length === 0) CSS.highlights.delete(`term-${kind}`);
        else CSS.highlights.set(`term-${kind}`, new Highlight(...ranges));
      }
    } catch (error) {
      // 色が出ないだけで、入力は止めない
      clearHighlights();
      log(`色を置けませんでした：${error instanceof Error ? error.message : String(error)}`);
    }
  };
  let frame: number | undefined;
  const scheduleHighlights = () => {
    if (frame !== undefined) return;
    frame = requestAnimationFrame(() => {
      frame = undefined;
      applyHighlights();
    });
  };

  const readBack = () => {
    current = segmentsText(collectSegments(element));
    // 形が崩れていたら、変換していないときに作り直す（変換中に書き換えると、変換中の字が確定してしまう）
    // 字の節が割れただけなら、つなぎ合わせる（作り直さない。カーソルはそのまま残る。エミュレーター：ブラウザに
    // 任せた Enter は、改行を別の字の節として差し込み、字の節を3つに割った）
    if (!composing && element.childNodes.length > 1 && Array.from(element.childNodes).every((n) => n.nodeType === Node.TEXT_NODE)) {
      element.normalize();
    }
    const first = element.firstChild;
    const raw = first?.nodeType === Node.TEXT_NODE ? first.nodeValue : null;
    const supportOnly =
      !composing && first !== null && raw !== null && element.childNodes.length === 1 && raw !== plainValue(current) &&
      (raw === current || raw === current + LINE_SUPPORT);
    if (supportOnly) {
      // 支えの字が足りない・余っているだけなら、字の節はそのままで足し引きする（作り直さない。
      // 作り直すと、iOS がカーソルの印を描かなくなる見込み。2026-11-07 Mac #24 P1）
      const node = first as Text;
      if (raw === current) node.appendData(LINE_SUPPORT);
      else node.deleteData(raw.length - LINE_SUPPORT.length, LINE_SUPPORT.length);
      log("A 支えの字を足し引きした（欄は作り直さない）");
    } else if (!composing && !isPlainShape(childKinds(element), current, raw)) {
      const caret = selectionOffsets()?.start ?? current.length;
      write(current);
      placeCaret(caret);
      log("欄の形を整えました（空の要素や割れた字の節を、本文から作り直した）");
    }
    onChange(current);
    scheduleHighlights();
  };

  const onBeforeInput = (e: InputEvent) => {
    if (e.isComposing || composing) return;
    if (e.inputType === "insertParagraph" || e.inputType === "insertLineBreak") {
      if (nativeEnter) {
        // ブラウザに任せる。改行が入ったあと（input）で、形を見て位置を記録する。
        // 本文の末で改行させると、ブラウザは最後の空の行を見せるために改行をもう1つ足す（エミュレーター：
        // 「猫です」の末で Enter →「猫です\n\n」）。先に支えの字を足しておき、その前に改行を入れさせる
        const first = element.firstChild;
        if (first && first.nodeType === Node.TEXT_NODE && !(first.nodeValue ?? "").endsWith(LINE_SUPPORT)) {
          (first as Text).appendData(LINE_SUPPORT);
        }
        return;
      }
      e.preventDefault();
      const sel = selectionOffsets();
      if (!sel) return;
      const done = replaceRange(current, sel.start, sel.end, "\n");
      // 書き直してカーソルを置くと、ブラウザが自分でカーソルの所へページと欄を送ることがある。
      // iOS は最後の空の列のカーソルの位置を欄の下の外と測り、ページを下へ送って欄の上側が隠れた
      // （2026-11-07 Mac #19 I1）。送り位置をいったん元へ戻し、送るのはこちら（revealSelection）だけにする
      const pageY = window.scrollY;
      const paneX = element.scrollLeft;
      const paneY = element.scrollTop;
      const restore = () => {
        if (window.scrollY !== pageY) window.scrollTo(window.scrollX, pageY);
        element.scrollLeft = paneX;
        element.scrollTop = paneY;
      };
      write(done.text);
      placeCaret(done.caret);
      restore();
      onChange(current);
      scheduleHighlights();
      // iOS は、カーソルを置いたあと、次のコマでも自分でページを送る（2026-11-07 Mac #20 K2：2回目の Enter の
      // 前に、欄がページの上の外へ出ていた）。次のコマで送り位置をもう一度戻してから、こちらで送る
      requestAnimationFrame(() => {
        restore();
        revealSelection(done.caret);
      });
      // 欄の中身がどう動くかを、Enter の直後と少しあとで記録に残す（Mac の確かめで、何が動いたかを見るため）
      dumpGeometry("Enter 0ms");
      for (const ms of [100, 500, 1500]) window.setTimeout(() => dumpGeometry(`Enter ${ms}ms`), ms);
    }
  };
  /**
   * カーソルが支えの字のうしろ（字の節の末）に来たら、支えの字の前へ戻す（そのまま打つと支えの字のうしろに
   * 字が入る。⌫ では見えない支えの字が消えるだけになる）
   */
  const onSelectionChange = () => {
    // カーソルが動いたら、こちらで描いた印を消す（測るときに置き直した同じ位置なら残す）
    if (ownState) {
      const sel = selectionOffsets();
      if (!sel || sel.start !== ownState.offset || sel.end !== ownState.offset) hideOwnCaret();
    }
    if (composing) return;
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || !selection.isCollapsed) return;
    const node = selection.anchorNode;
    if (!node || node !== element.firstChild || node.nodeType !== Node.TEXT_NODE) return;
    const value = node.nodeValue ?? "";
    if (value.endsWith(LINE_SUPPORT) && selection.anchorOffset === value.length) selection.collapse(node, value.length - 1);
  };
  /**
   * **Enter をブラウザに任せる形**（試しの画面の切り替え。2026-11-07 Mac #24：こちらで欄を書き直して
   * カーソルを置くと、iOS は最後の空の列のカーソルの印を、支えが `<br>` でも見えない字でも描かなかった。
   * 印は iOS 自身が描くもので、こちらが中身を書き換えると、次に打つまで描かないのかもしれない。ブラウザに
   * 改行を入れさせて比べる）
   */
  let nativeEnter = false;
  const onInput = (e: Event) => {
    hideOwnCaret();
    readBack();
    const type = (e as InputEvent).inputType;
    if (nativeEnter && (type === "insertParagraph" || type === "insertLineBreak")) {
      dumpGeometry("Enter（ブラウザ） 0ms");
      for (const ms of [100, 500, 1500]) window.setTimeout(() => dumpGeometry(`Enter（ブラウザ） ${ms}ms`), ms);
    }
  };
  const onCompStart = () => {
    hideOwnCaret();
    composing = true;
    log("A 変換の始まり");
  };
  const onCompEnd = (e: CompositionEvent) => {
    composing = false;
    log(`A 確定「${e.data}」`);
    // 確定の字が入りきってから形を見る（端末によって compositionend と input の順が違う）
    window.setTimeout(() => {
      if (!composing) readBack();
    }, 0);
  };
  /**
   * **欄とページの位置を1行で記録に残す**（2026-11-07 Mac #22 M1：Enter のあと欄の中身が右へずれたが、
   * 欄の横送り（scrollLeft）は動いていなかった。ページの横の位置・見える範囲の横の位置・拡大を見る）。
   * sl＝欄の横送り、欄＝欄の左右、頭＝本文の1字目の左右、印＝カーソルの左右と上下、
   * 頁＝ページの横の送り、vv＝見える範囲の左（offsetLeft／pageLeft）・幅・拡大
   */
  const dumpGeometry = (label: string) => {
    const round = (n: number) => Math.round(n);
    const box = element.getBoundingClientRect();
    let head = "-";
    const textNode = element.firstChild;
    if (textNode && textNode.nodeType === Node.TEXT_NODE && (textNode.nodeValue ?? "").length > 0) {
      const r = document.createRange();
      r.setStart(textNode, 0);
      r.setEnd(textNode, 1);
      const h = r.getBoundingClientRect();
      head = `${round(h.left)}〜${round(h.right)}`;
    }
    let caret = "-";
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0 && element.contains(selection.getRangeAt(0).startContainer)) {
      const c = selection.getRangeAt(0).getBoundingClientRect();
      caret = `${round(c.left)}〜${round(c.right)}/${round(c.top)}〜${round(c.bottom)}`;
    }
    const vv = window.visualViewport;
    const v = vv ? `${round(vv.offsetLeft)}/${round(vv.pageLeft)}・幅${round(vv.width)}・拡大${vv.scale.toFixed(2)}` : "-";
    log(`A 位置 ${label}：sl${round(element.scrollLeft)} 欄${round(box.left)}〜${round(box.right)} 頭${head} 印${caret} 頁${round(window.scrollX)} vv${v}`);
  };
  /** 見える範囲が横へ動いたら記録する（同じ値はくり返さない） */
  let lastPan = "";
  const onViewportPan = () => {
    const vv = window.visualViewport;
    if (!vv || document.activeElement !== element) return;
    const pan = `${Math.round(vv.offsetLeft)}/${Math.round(vv.pageLeft)}/${vv.scale.toFixed(2)}/${Math.round(window.scrollX)}`;
    if (pan === lastPan) return;
    lastPan = pan;
    dumpGeometry("見える範囲が動いた");
  };
  window.visualViewport?.addEventListener("scroll", onViewportPan);
  window.visualViewport?.addEventListener("resize", onViewportPan);

  /** キーボードが出て見える範囲が縮んだら、カーソルを見える所へ（iOS で欄が隠れた。2026-11-07 Mac） */
  const stopWatching = watchVisibleBand(() => {
    if (document.activeElement !== element) return;
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;
    const r = selection.getRangeAt(0).getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return;
    const caret = clampCaretToPane(r, element.getBoundingClientRect(), element.classList.contains("vertical"));
    revealCaret({ getBoundingClientRect: () => caret as DOMRect }, element);
  });

  element.addEventListener("beforeinput", onBeforeInput);
  element.addEventListener("input", onInput);
  element.addEventListener("blur", hideOwnCaret);
  element.addEventListener("pointerdown", hideOwnCaret);
  element.addEventListener("scroll", placeOwnCaret);
  window.addEventListener("scroll", placeOwnCaret);
  window.visualViewport?.addEventListener("scroll", placeOwnCaret);
  window.visualViewport?.addEventListener("resize", placeOwnCaret);
  element.addEventListener("compositionstart", onCompStart);
  element.addEventListener("compositionend", onCompEnd);
  document.addEventListener("selectionchange", onSelectionChange);
  write(text);
  scheduleHighlights();

  return {
    getText: () => current,
    setText(next) {
      write(next);
      scheduleHighlights();
    },
    setNativeEnter(native) {
      nativeEnter = native;
      log(native ? "A の Enter をブラウザに任せる" : "A の Enter をこちらで入れる");
    },
    setTerms(find) {
      findTerms = find;
      scheduleHighlights();
    },
    destroy() {
      element.removeEventListener("beforeinput", onBeforeInput);
      element.removeEventListener("input", onInput);
      element.removeEventListener("blur", hideOwnCaret);
      element.removeEventListener("pointerdown", hideOwnCaret);
      element.removeEventListener("scroll", placeOwnCaret);
      window.removeEventListener("scroll", placeOwnCaret);
      window.visualViewport?.removeEventListener("scroll", placeOwnCaret);
      window.visualViewport?.removeEventListener("resize", placeOwnCaret);
      hideOwnCaret();
      element.removeEventListener("compositionstart", onCompStart);
      element.removeEventListener("compositionend", onCompEnd);
      document.removeEventListener("selectionchange", onSelectionChange);
      stopWatching();
      window.visualViewport?.removeEventListener("scroll", onViewportPan);
      window.visualViewport?.removeEventListener("resize", onViewportPan);
      if (frame !== undefined) cancelAnimationFrame(frame);
      clearHighlights();
    },
  };
}
