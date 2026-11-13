import { revealCaret, watchVisibleBand } from "./caretVisible";
import {
  type ComposedToken,
  chunkSignature,
  composedHtml,
  deleteRange,
  describeCaretAt,
  emphasisAction,
  readingProblem,
  rubySource,
  rubyTarget,
  isChunk,
  readComposed,
  snapOutOfChunk,
  tokenizeComposed,
  widenToChunks,
} from "./composedText";
import { askText } from "./dialog";
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
 * - ⌫・Delete は、カーソルのすぐ前・すぐ後が塊なら塊まるごと、塊にかかった範囲なら塊ごと消す。地の字の
 *   1字消しはブラウザのまま（2本目。`composedText.ts` の `deleteRange`）
 * - カーソルが塊の中や欄の直下に来たら、近いほうの塊の外（字の節の中）へ置き直す
 * - 押した・変換の始まり・確定のあと・⌫ で塊を消した、を記録（trial-log）に残す。塊の直前・直後に
 *   打てたかを、実機の確かめで記録から裏付ける
 * - 用語の色は、この形ではまだ付けない
 */
export interface ComposedPane {
  getText(): string;
  setText(text: string): void;
  /** 組んで出しているか（false なら、往復が合わなかったので記法のまま出している） */
  isComposed(): boolean;
  /** ［ルビ］：選んだ字かカーソルの前の漢字に振る。ルビの所なら読みを直す（空にすると外す）。振れなければ notify に訳 */
  addRuby(notify: (message: string) => void): Promise<void>;
  /** ［傍点］：選んだ字に付ける。傍点の所なら外す。付けられなければ notify に訳 */
  toggleEmphasis(notify: (message: string) => void): void;
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
  let lastSel: { start: number; end: number } | undefined;
  /** いまの選択（焦点が外れていれば、欄の中の最後の選択） */
  const currentSel = () => selectionOffsets() ?? lastSel ?? { start: current.length, end: current.length };

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
    } else if (e.inputType.startsWith("delete")) {
      // 塊のすぐ前・すぐ後・塊にかかった範囲だけ、こちらで塊ごと消す（地の字の1字消しはブラウザのまま）
      const direction = /Forward$/.test(e.inputType) ? "forward" : "backward";
      const range = deleteRange(tokens, sel.start, sel.end, direction);
      if (!range) return;
      e.preventDefault();
      replace(range.start, range.end, "", range.chunk ? `${direction === "backward" ? "⌫" : "Delete"} で塊を消した（${range.chunk.src}）` : "塊にかかった範囲を消した");
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
  const onInput = (e: Event) => {
    readBack();
    // 変換を通さずに入った字（ハードのキーボード・記号のキーなど）も、入った所を記録に残す
    const input = e as InputEvent;
    if (!composing && input.inputType === "insertText") logCaret(`C 打った「${input.data ?? ""}」のあと`);
  };
  /** カーソルの所の様子を記録に残す（塊の直前・直後に打てたかを、記録で裏付ける） */
  const logCaret = (label: string) => {
    const sel = selectionOffsets();
    log(`${label}：${sel ? (sel.start === sel.end ? describeCaretAt(tokens, sel.start) : `${sel.start}〜${sel.end}字目を選んでいる`) : "カーソルなし"}`);
  };
  /**
   * **カーソルが塊の中や欄の直下に来たら、近いほうの塊の外（字の節の中）へ置き直す**（本体もルビの中には
   * カーソルを入れない。字の節の中に置くのは、iOS が字の節の外のカーソルを描かないことがあったため）
   */
  const onSelectionChange = () => {
    if (composing) return;
    // ［ルビ］［傍点］を押したときに焦点が外れても使えるように、欄の中の最後の選択を覚える
    const seen = selectionOffsets();
    if (seen) lastSel = seen;
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || !selection.isCollapsed) return;
    const node = selection.anchorNode;
    if (!node || !element.contains(node)) return;
    const inChunk = (node instanceof Element ? node : node.parentElement)?.closest("[data-src]");
    const onPane = node === element;
    if (!inChunk && !onPane) return;
    const sel = selectionOffsets();
    if (!sel) return;
    const offset = inChunk instanceof HTMLElement ? snapOutOfChunk(tokens, sel.start) : sel.start;
    placeCaret(offset);
    log(`C カーソルを${inChunk ? "塊の外" : "字の節の中"}へ置き直した：${describeCaretAt(tokens, offset)}`);
  };
  /** 押したら、押した所のカーソルの様子を記録に残す（iPad・Android の実機の確かめ） */
  const onPointerUp = (e: PointerEvent) => {
    const point = `${Math.round(e.clientX)}/${Math.round(e.clientY)}`;
    window.setTimeout(() => logCaret(`C 押した（点 ${point}、${e.pointerType}）`), 150);
  };
  const onCompStart = () => {
    composing = true;
    logCaret("C 変換の始まり");
  };
  const onCompEnd = (e: CompositionEvent) => {
    composing = false;
    // 確定の字が入りきってから形を見る（端末によって compositionend と input の順が違う）
    window.setTimeout(() => {
      if (composing) return;
      readBack();
      logCaret(`C 確定「${e.data}」のあと`);
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
  element.addEventListener("pointerup", onPointerUp);
  document.addEventListener("selectionchange", onSelectionChange);
  write(text);
  log(composed ? `C 組んだ（塊 ${tokens.filter(isChunk).length}つ）` : "C 記法のまま出した");

  return {
    getText: () => current,
    setText(next) {
      if (next === current && element.childNodes.length > 0) return;
      write(next);
    },
    isComposed: () => composed,
    async addRuby(notify) {
      if (composing) return notify("変換を確定してから押してください");
      if (!composed) return notify("組めていないので、記法のまま {漢字|かんじ} と打ってください");
      const sel = currentSel();
      const target = rubyTarget(current, tokens, sel.start, sel.end);
      if (target.kind === "none") {
        log(`C ［ルビ］：振らなかった（${target.reason}）`);
        return notify(target.reason);
      }
      const base = target.kind === "new" ? target.base : target.chunk.base;
      const reading = await askText(`「${base}」の読み`, {
        initial: target.kind === "edit" ? target.chunk.reading : "",
        note: target.kind === "edit" ? "読みを消して決めると、ルビを外します" : "",
        validate: readingProblem,
      });
      element.focus({ preventScroll: true });
      if (reading === undefined || (target.kind === "new" && reading === "")) {
        placeCaret(sel.end);
        log("C ［ルビ］：やめた");
        return;
      }
      const start = target.kind === "new" ? target.start : target.chunk.start;
      const end = target.kind === "new" ? target.end : target.chunk.start + target.chunk.src.length;
      replace(start, end, rubySource(base, reading), target.kind === "new" ? `ルビを振った（${rubySource(base, reading)}）` : reading === "" ? `ルビを外した（${base}）` : `ルビの読みを直した（${rubySource(base, reading)}）`);
    },
    toggleEmphasis(notify) {
      if (composing) return notify("変換を確定してから押してください");
      if (!composed) return notify("組めていないので、記法のまま {{語}} と打ってください");
      const sel = currentSel();
      const action = emphasisAction(current, tokens, sel.start, sel.end);
      if (action.kind === "none") {
        log(`C ［傍点］：付けなかった（${action.reason}）`);
        return notify(action.reason);
      }
      element.focus({ preventScroll: true });
      replace(action.start, action.end, action.src, action.kind === "add" ? `傍点を付けた（${action.src}）` : `傍点を外した（${action.src}）`);
    },
    destroy() {
      element.removeEventListener("beforeinput", onBeforeInput);
      element.removeEventListener("input", onInput);
      element.removeEventListener("copy", onCopyEvent);
      element.removeEventListener("cut", onCutEvent);
      element.removeEventListener("compositionstart", onCompStart);
      element.removeEventListener("compositionend", onCompEnd);
      element.removeEventListener("pointerup", onPointerUp);
      document.removeEventListener("selectionchange", onSelectionChange);
      stopWatching();
    },
  };
}

