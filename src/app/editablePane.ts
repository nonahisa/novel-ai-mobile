import { revealCaret, watchVisibleBand } from "./caretVisible";
import type { TermFinder } from "./editContextPane";
import { type EditableSegment, locateOffset, segmentsText, trailingBreakNeeded } from "./editableText";
import { TERM_KINDS } from "./termHighlight";

/**
 * **A（いまの形）の入力欄を contenteditable で作る**（作者の答え 2026-11-07「両方」。用語の色付けのため）。
 *
 * 入力はブラウザのまま（変換中の線・候補の窓・カーソル・選択もブラウザが描く。縦書きでは線は左）。
 * textarea から替えたのは、**中の字に色を付けるため**だけ。色は本体の原稿エディターと同じく
 * **CSS Custom Highlight API** で置き、DOM は書き換えない（書き換えると変換中の字とカーソルが飛ぶ）。
 *
 * - `contenteditable="plaintext-only"`（太字などの飾りを入れない）。使えなければ `true`
 * - 改行（Enter）はこちらで「`\n` の字」として入れる。ブラウザに任せると `<div>`・`<br>` ができ、
 *   ブラウザごとに中身の形が変わる（`editableText.ts` はどちらも読めるが、形は少ないほうがずれにくい）
 * - 色は1コマに1回まとめて置き直す（打鍵のたびに範囲を作り直さない）
 * - 色付けの仕組みが無い WebView では、色が出ないだけで入力は動く
 */
export interface EditablePane {
  getText(): string;
  setText(text: string): void;
  setTerms(find: TermFinder): void;
  destroy(): void;
}

function collectSegments(root: HTMLElement): EditableSegment<Node>[] {
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
      } else if (child instanceof HTMLBRElement) {
        // 欄のいちばん後ろの <br> は支え（数えない）
        if (!(child.parentNode === root && child === root.lastChild)) push({ kind: "newline", node: child });
      } else if (child instanceof HTMLElement) {
        const block = child.tagName === "DIV" || child.tagName === "P";
        if (block && soFar !== "" && !soFar.endsWith("\n")) push({ kind: "newline", node: child });
        walk(child);
      }
    }
  };
  walk(root);
  return out;
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
  const highlightsUsable = typeof CSS !== "undefined" && "highlights" in CSS && typeof Highlight !== "undefined";

  const write = (next: string) => {
    element.textContent = next;
    if (trailingBreakNeeded(next)) element.appendChild(document.createElement("br"));
    current = next;
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
    onChange(current);
    scheduleHighlights();
  };

  /** カーソルの所へ字を入れる（改行用）。ブラウザに任せると <div>・<br> ができる */
  const insertAtSelection = (inserted: string) => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    if (!element.contains(range.commonAncestorContainer)) return;
    range.deleteContents();
    const node = document.createTextNode(inserted);
    range.insertNode(node);
    // 支えの <br> を付け直す（本文の終わりが改行なら要る、そうでなければ要らない）
    const last = element.lastChild;
    if (last instanceof HTMLBRElement) last.remove();
    if (trailingBreakNeeded(segmentsText(collectSegments(element)))) element.appendChild(document.createElement("br"));
    const after = document.createRange();
    after.setStartAfter(node);
    after.collapse(true);
    selection.removeAllRanges();
    selection.addRange(after);
    readBack();
  };

  const onBeforeInput = (e: InputEvent) => {
    if (e.isComposing) return;
    if (e.inputType === "insertParagraph" || e.inputType === "insertLineBreak") {
      e.preventDefault();
      insertAtSelection("\n");
    }
  };
  const onInput = () => readBack();
  const onCompStart = () => log("A 変換の始まり");
  const onCompEnd = (e: CompositionEvent) => log(`A 確定「${e.data}」`);
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
