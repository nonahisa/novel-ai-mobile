import { caretScrollDelta, revealCaret, watchVisibleBand } from "./caretVisible";
import type { TermFinder } from "./editContextPane";
import {
  type EditableChildKind,
  type EditableSegment,
  caretPlacement,
  isPlainShape,
  locateOffset,
  replaceRange,
  segmentsText,
  trailingBreakNeeded,
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
        push({ kind: "text", node: child, text: child.nodeValue ?? "" });
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
    element.textContent = next;
    if (trailingBreakNeeded(next)) element.appendChild(document.createElement("br"));
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
    if (at.kind === "beforeBreak" || !textNode || textNode.nodeType !== Node.TEXT_NODE) {
      const br = element.lastChild;
      if (br && br.nodeName === "BR") range.setStartBefore(br);
      else range.setStart(element, element.childNodes.length);
    } else {
      range.setStart(textNode, at.kind === "text" ? at.offset : 0);
    }
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
  };

  /** カーソルを、欄の中でもページでも見える所へ送る（縦書きは欄を横へ、横書きは欄を縦へ。そのあとページ） */
  const revealSelection = () => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    let rect = range.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
      // 空の行の頭などは大きさ0で返る。支えの <br> か、カーソルの前の字の節で測り直す
      const host = range.startContainer.nodeType === Node.ELEMENT_NODE ? (range.startContainer.childNodes[range.startOffset] as Element | undefined) : undefined;
      const fallback = host && host.nodeType === Node.ELEMENT_NODE ? host : range.startContainer.parentElement;
      if (!fallback) return;
      rect = fallback.getBoundingClientRect();
    }
    const box = element.getBoundingClientRect();
    if (element.classList.contains("vertical")) {
      const margin = 24;
      if (rect.left < box.left + margin) element.scrollLeft -= box.left + margin - rect.left;
      else if (rect.right > box.right - margin) element.scrollLeft += rect.right - (box.right - margin);
    } else {
      const delta = caretScrollDelta(rect, { top: box.top, height: box.height }, { top: 8, bottom: 8 });
      if (delta !== 0) element.scrollTop += delta;
    }
    revealCaret(range);
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
    if (!composing && !isPlainShape(childKinds(element), current)) {
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
      e.preventDefault();
      const sel = selectionOffsets();
      if (!sel) return;
      const done = replaceRange(current, sel.start, sel.end, "\n");
      write(done.text);
      placeCaret(done.caret);
      onChange(current);
      scheduleHighlights();
      revealSelection();
    }
  };
  const onInput = () => readBack();
  const onCompStart = () => {
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
  /** キーボードが出て見える範囲が縮んだら、カーソルを見える所へ（iOS で欄が隠れた。2026-11-07 Mac） */
  const stopWatching = watchVisibleBand(() => {
    if (document.activeElement !== element) return;
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) revealCaret(selection.getRangeAt(0));
  });

  element.addEventListener("beforeinput", onBeforeInput);
  element.addEventListener("input", onInput);
  element.addEventListener("compositionstart", onCompStart);
  element.addEventListener("compositionend", onCompEnd);
  write(text);
  scheduleHighlights();

  return {
    getText: () => current,
    setText(next) {
      write(next);
      scheduleHighlights();
    },
    setTerms(find) {
      findTerms = find;
      scheduleHighlights();
    },
    destroy() {
      element.removeEventListener("beforeinput", onBeforeInput);
      element.removeEventListener("input", onInput);
      element.removeEventListener("compositionstart", onCompStart);
      element.removeEventListener("compositionend", onCompEnd);
      stopWatching();
      if (frame !== undefined) cancelAnimationFrame(frame);
      clearHighlights();
    },
  };
}
