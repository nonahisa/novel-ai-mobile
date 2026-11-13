import { revealCaret, watchVisibleBand } from "./caretVisible";
import {
  type ComposedToken,
  chunkSignature,
  composedHtml,
  isChunk,
  readComposed,
  snapOutOfChunk,
  tokenizeComposed,
  widenToChunks,
} from "./composedText";
import { LINE_SUPPORT, plainValue, replaceRange } from "./editableText";

/**
 * **C（組んで書く）の入力欄**（2026-11-13 作者の答え「まず縦書きの試しで、本体と同じ『塊』の形を試す」）。
 * 決まりは `composedText.ts`。本体の原稿エディターの「組んで書く」面（本体の設計書 6.34）に倣う。
 *
 * - 欄は `contenteditable`。ルビ・傍点は `contenteditable="false"` の塊（元の記法は `data-src`）
 * - **変換中は欄に触らない**（触ると変換中の字が消える・確定する。本体の 6.34 の決まり）。
 *   組み直すのは、変換していないときだけ
 * - 組み直すのは、こちらで本文を変えたとき（Enter・貼り付け・切り取り）と、打ったあとに欄の塊が
 *   本文の塊と合わなくなったとき（`}` を打って記法が閉じた・ブラウザが塊を消した・空の要素が残った）
 * - 入る前と組み直すたびに「記法 → 欄 → 記法」の往復を確かめ、1字でも違えば組まずに記法のまま出す
 *   （安全弁。本体の 6.34.5）
 * - 用語の色は、この形ではまだ付けない
 */
export interface ComposedPane {
  getText(): string;
  setText(text: string): void;
  /** 組んで出しているか（false なら、往復が合わなかったので記法のまま出している） */
  isComposed(): boolean;
  destroy(): void;
}

export function mountComposedPane(
  element: HTMLElement,
  text: string,
  onChange: (text: string) => void,
  log: (line: string) => void = () => undefined
): ComposedPane {
  element.contentEditable = "true";
  element.setAttribute("role", "textbox");
  element.setAttribute("aria-multiline", "true");
  element.spellcheck = false;
  element.setAttribute("autocapitalize", "off");
  element.setAttribute("autocorrect", "off");

  let current = text;
  let tokens: ComposedToken[] = [];
  let composed = true;
  let composing = false;

  /** 欄を本文から組み直す。往復が合わなければ記法のまま出す */
  const write = (next: string) => {
    current = next;
    tokens = tokenizeComposed(next);
    element.innerHTML = composedHtml(tokens);
    const back = readComposed(element);
    if (back !== next) {
      composed = false;
      tokens = [{ kind: "text", start: 0, text: next }];
      element.textContent = plainValue(next);
      log(`C 往復が合わなかったので、組まずに記法のまま出した（本文 ${next.length}字・読み戻し ${back.length}字）`);
      return;
    }
    if (!composed) log("C 組めるようになった");
    composed = true;
  };

  /** 欄の頭から (container, offset) までの本文の字の数（塊は記法の字の数。塊の中なら塊の末まで） */
  const offsetOf = (container: Node, offset: number): number => {
    const range = document.createRange();
    range.setStart(element, 0);
    range.setEnd(container, offset);
    const holder = document.createElement("div");
    holder.appendChild(range.cloneContents());
    return readComposed(holder).length;
  };
  const selectionOffsets = (): { start: number; end: number } | undefined => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return undefined;
    const range = selection.getRangeAt(0);
    if (!element.contains(range.startContainer) || !element.contains(range.endContainer)) return undefined;
    return { start: offsetOf(range.startContainer, range.startOffset), end: offsetOf(range.endContainer, range.endOffset) };
  };

  /**
   * 本文の offset 字目にカーソルを置く。塊の中なら近いほうの外へ。いつも字の節の中に置く
   * （塊の両隣には字の節がある。`composedHtml`）。支えの字は数えず、その前に置く
   */
  const placeCaret = (offset: number) => {
    const selection = window.getSelection();
    if (!selection) return;
    const wanted = snapOutOfChunk(tokens, Math.min(Math.max(offset, 0), current.length));
    let at = 0;
    let target: { node: Node; index: number } | undefined;
    for (const child of Array.from(element.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        const value = child.nodeValue ?? "";
        const visible = value.split(LINE_SUPPORT).join("").length;
        if (wanted >= at && wanted <= at + visible) {
          // wanted - at 字目（支えの字は数えない）の DOM の位置。支えの字の前に置く
          let count = 0;
          let index = 0;
          while (count < wanted - at) {
            if (value[index] !== LINE_SUPPORT) count++;
            index++;
          }
          target = { node: child, index };
          // 塊の直前と直後の両方に当たるときは、うしろの字の節（塊の直後）を選ぶ
          if (wanted < at + visible) break;
        }
        at += visible;
      } else if (child instanceof HTMLElement && child.dataset.src !== undefined) {
        at += child.dataset.src.length;
      }
    }
    const range = document.createRange();
    if (target) range.setStart(target.node, target.index);
    else range.setStart(element, element.childNodes.length);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
  };

  /** 本文を変えて組み直し、カーソルを置く（Enter・貼り付け・切り取り） */
  const replace = (start: number, end: number, inserted: string, why: string) => {
    const wide = widenToChunks(tokens, start, end);
    const done = replaceRange(current, wide.start, wide.end, inserted);
    write(done.text);
    placeCaret(done.caret);
    onChange(current);
    log(`C ${why}：${wide.start}〜${wide.end}字目 → カーソル ${done.caret}字目${wide.start !== start || wide.end !== end ? "（塊にかかったので塊ごと）" : ""}`);
    requestAnimationFrame(() => revealCaret(caretMark(), element));
  };

  /** ページを送るためのカーソルの位置（測れなければ欄） */
  const caretMark = () => ({
    getBoundingClientRect: () => {
      const selection = window.getSelection();
      const r = selection && selection.rangeCount > 0 ? selection.getRangeAt(0).getBoundingClientRect() : undefined;
      return r && (r.width > 0 || r.height > 0) ? r : element.getBoundingClientRect();
    },
  });

  /** 欄の塊（data-src）の並び */
  const domSignature = (): string =>
    Array.from(element.querySelectorAll<HTMLElement>("[data-src]"))
      .map((el) => el.dataset.src ?? "")
      .join("\u0000");
  /** 欄の直下が、字の節と塊だけか（ブラウザが <br>・<div>・空の <span> を作っていないか） */
  const flatShape = (): boolean =>
    Array.from(element.childNodes).every((n) => n.nodeType === Node.TEXT_NODE || (n instanceof HTMLElement && n.dataset.src !== undefined));

  /** 打ったあと：本文を読み戻し、欄の形が本文と合わなければ（変換していないときに）組み直す */
  const readBack = () => {
    const next = readComposed(element);
    current = next;
    if (!composing) {
      const fresh = tokenizeComposed(next);
      const mismatch = composed && (chunkSignature(fresh) !== domSignature() || !flatShape());
      if (mismatch) {
        const caret = selectionOffsets()?.start ?? next.length;
        write(next);
        placeCaret(caret);
        log(`C 組み直した（塊 ${tokens.filter(isChunk).length}つ、カーソル ${caret}字目）`);
      } else {
        tokens = composed ? fresh : [{ kind: "text", start: 0, text: next }];
      }
    }
    onChange(current);
  };

  const onBeforeInput = (e: InputEvent) => {
    if (e.isComposing || composing) return;
    const sel = selectionOffsets();
    if (!sel) return;
    if (e.inputType === "insertParagraph" || e.inputType === "insertLineBreak") {
      e.preventDefault();
      replace(sel.start, sel.end, "\n", "改行");
    } else if (e.inputType === "insertFromPaste" || e.inputType === "insertFromDrop") {
      const data = e.dataTransfer?.getData("text/plain") ?? e.data ?? "";
      e.preventDefault();
      replace(sel.start, sel.end, data.replace(/\r\n?/g, "\n"), "貼り付け");
    }
  };
  /** 写す・切り取るときは、塊を記法の字のまま写す（本体の 6.34.5） */
  const onCopy = (e: ClipboardEvent, cut: boolean) => {
    const sel = selectionOffsets();
    if (!sel || sel.start === sel.end || !e.clipboardData) return;
    const wide = widenToChunks(tokens, sel.start, sel.end);
    e.clipboardData.setData("text/plain", current.slice(wide.start, wide.end));
    e.preventDefault();
    if (cut) replace(wide.start, wide.end, "", "切り取り");
  };
  const onCopyEvent = (e: ClipboardEvent) => onCopy(e, false);
  const onCutEvent = (e: ClipboardEvent) => onCopy(e, true);
  const onInput = () => readBack();
  const onCompStart = () => {
    composing = true;
    const sel = selectionOffsets();
    log(`C 変換の始まり（${sel ? sel.start : "-"}字目）`);
  };
  const onCompEnd = (e: CompositionEvent) => {
    composing = false;
    log(`C 確定「${e.data}」`);
    // 確定の字が入りきってから形を見る（端末によって compositionend と input の順が違う）
    window.setTimeout(() => {
      if (!composing) readBack();
    }, 0);
  };

  /** キーボードが出て見える範囲が縮んだら、カーソルを見える所へ */
  const stopWatching = watchVisibleBand(() => {
    if (document.activeElement === element && !composing) revealCaret(caretMark(), element);
  });

  element.addEventListener("beforeinput", onBeforeInput);
  element.addEventListener("input", onInput);
  element.addEventListener("copy", onCopyEvent);
  element.addEventListener("cut", onCutEvent);
  element.addEventListener("compositionstart", onCompStart);
  element.addEventListener("compositionend", onCompEnd);
  write(text);
  log(composed ? `C 組んだ（塊 ${tokens.filter(isChunk).length}つ）` : "C 記法のまま出した");

  return {
    getText: () => current,
    setText(next) {
      if (next === current && element.childNodes.length > 0) return;
      write(next);
    },
    isComposed: () => composed,
    destroy() {
      element.removeEventListener("beforeinput", onBeforeInput);
      element.removeEventListener("input", onInput);
      element.removeEventListener("copy", onCopyEvent);
      element.removeEventListener("cut", onCutEvent);
      element.removeEventListener("compositionstart", onCompStart);
      element.removeEventListener("compositionend", onCompEnd);
      stopWatching();
    },
  };
}

