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
import { UndoHistory } from "./undoHistory";

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
 * - 取り消し・やり直しはアプリが手を積んで持つ（設計書 5.5。`undoHistory.ts`）。変換は確定して1手、
 *   ルビ・傍点・改行・貼り付けも1手。ブラウザの取り消し（Ctrl+Z など）もこちらの手で戻す
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
  /** ［取り消し］：1手戻す（変換中は何もしない） */
  undo(): void;
  /** ［やり直し］：戻した手をもう一度当てる */
  redo(): void;
  canUndo(): boolean;
  canRedo(): boolean;
  destroy(): void;
}

export function mountComposedPane(
  element: HTMLElement,
  text: string,
  onChange: (text: string) => void,
  log: (line: string) => void = () => undefined,
  /** 取り消し・やり直しができるかが変わったら呼ぶ（ボタンを押せる・押せないに） */
  onHistory: (state: { canUndo: boolean; canRedo: boolean }) => void = () => undefined,
  options: { ownCaretWhenVertical?: boolean } = {}
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

  const history = new UndoHistory();
  /** 最後に手を積んだときの本文（変換中に変わった分は、確定のときにまとめて1手にする） */
  let settled = text;
  const tellHistory = () => onHistory({ canUndo: history.canUndo(), canRedo: history.canRedo() });
  /** settled から今の本文までを1手として積む */
  const commit = (kind: "type" | "other") => {
    if (current === settled) return;
    history.record(settled, current, kind, Date.now());
    settled = current;
    tellHistory();
  };

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
    const range = document.createRange();
    const point = domPoint(wanted);
    range.setStart(point.node, point.index);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
  };
  /** 本文の start〜end 字目を選ぶ（塊の境目なら、塊の外の字の節に端を置く） */
  const placeRange = (start: number, end: number) => {
    const selection = window.getSelection();
    if (!selection) return;
    const head = domPoint(start);
    const tail = domPoint(end);
    const range = document.createRange();
    range.setStart(head.node, head.index);
    range.setEnd(tail.node, tail.index);
    selection.removeAllRanges();
    selection.addRange(range);
  };
  /** 本文の wanted 字目の DOM の位置（字の節の中。塊の直前と直後の両方に当たるときは、うしろの字の節） */
  const domPoint = (wanted: number): { node: Node; index: number } => {
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
    return target ?? { node: element, index: element.childNodes.length };
  };

  /** 本文を変えて組み直し、カーソルを置く（Enter・貼り付け・切り取り） */
  const replace = (start: number, end: number, inserted: string, why: string) => {
    const wide = widenToChunks(tokens, start, end);
    const done = replaceRange(current, wide.start, wide.end, inserted);
    // 打ちかけの手を先に閉じてから、この操作を1手として積む
    commit("type");
    write(done.text);
    commit("other");
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
      commit("type");
    }
    onChange(current);
  };

  /** 取り消し・やり直しの結果を欄へ出す */
  const step = (which: "undo" | "redo") => {
    if (composing) return;
    commit("type");
    const back = which === "undo" ? history.undo(current) : history.redo(current);
    if (!back) {
      tellHistory();
      return;
    }
    write(back.text);
    settled = current;
    placeCaret(back.caret);
    onChange(current);
    tellHistory();
    log(`C ${which === "undo" ? "取り消した" : "やり直した"}：カーソル ${back.caret}字目`);
    requestAnimationFrame(() => revealCaret(caretMark(), element));
  };

  const onBeforeInput = (e: InputEvent) => {
    if (e.isComposing || composing) return;
    flushSnap();
    // ブラウザの取り消し（Ctrl+Z・iPad の取り消しのキーなど）は使わず、こちらの手で戻す
    if (e.inputType === "historyUndo" || e.inputType === "historyRedo") {
      e.preventDefault();
      step(e.inputType === "historyUndo" ? "undo" : "redo");
      return;
    }
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
  /**
   * 置き直すのは、指が離れてカーソルが止まってから（2026-11-16 iPad の試し9）。iPad の長押しは、指の動きに
   * 合わせてカーソルを動かす。動くたびに塊の外へ戻すと、指と引っぱり合って範囲が作れなかった
   */
  let touching = false;
  let snapTimer: number | undefined;
  const SNAP_SETTLE_MS = 150;
  const scheduleSnap = () => {
    window.clearTimeout(snapTimer);
    snapTimer = window.setTimeout(snapCaretOutOfChunk, SNAP_SETTLE_MS);
  };
  /** 待っている置き直しを、いますぐ済ませる（打つ前に） */
  const flushSnap = () => {
    if (snapTimer === undefined) return;
    window.clearTimeout(snapTimer);
    snapTimer = undefined;
    snapCaretOutOfChunk();
  };
  /**
   * 短く押しただけ（長押しでもなぞりでもない）なら、前のようにすぐ置き直す（2026-11-17 エミュレーター）。
   * 待つと、そのあいだ Android がカーソルを書けない所（塊の中）にあると見て、キーボードを閉じた
   */
  const LONG_PRESS_MS = 350;
  let touchStartedAt = 0;
  let longGesture = false;
  /**
   * 指の知らせ（touchstart・touchmove）が最後に来た時刻。iPad でつまみを引くと、touchstart は来るが touchend が
   * 次に触れるまで来なかった（2026-11-17 Mac の iPad mini 0.1.73。39秒・20秒）。そのあいだ「指が触れている」まま
   * なので置き直しも選び直しも止まっていた。知らせが来ないまま選びが動いたら、指は離れたと見なす
   */
  let lastTouchAt = 0;
  const TOUCH_SILENT_MS = 1500;
  /**
   * 指と選びの動きを記録に残す（2026-11-17。iPad の 0.1.70 で、長押しでなぞっても範囲ができなかった訳を、
   * Mac の試しの記録で見分けるため）。選びは変わったときだけ、1秒に5行まで
   */
  let lastSelLog = "";
  let lastSelLogAt = 0;
  const logSelectionWhileTouching = () => {
    const sel = selectionOffsets();
    const text = sel ? (sel.start === sel.end ? `カーソル ${sel.start}字目` : `${sel.start}〜${sel.end}字目`) : "選びなし";
    const now = Date.now();
    if (text === lastSelLog || now - lastSelLogAt < 200) return;
    lastSelLog = text;
    lastSelLogAt = now;
    log(`C 指の間の選び：${text}`);
  };
  const onTouchStart = () => {
    touching = true;
    touchStartedAt = Date.now();
    lastTouchAt = touchStartedAt;
    longGesture = false;
    lastSelLog = "";
    window.clearTimeout(snapTimer);
    log("C 指：触れた");
  };
  const onTouchEnd = (e: TouchEvent) => {
    touching = false;
    longGesture = Date.now() - touchStartedAt >= LONG_PRESS_MS;
    log(`C 指：${e.type === "touchcancel" ? "取り消された（端末が引き取った）" : "離れた"}（${Date.now() - touchStartedAt}ms）`);
    window.clearTimeout(snapTimer);
    snapTimer = undefined;
    if (longGesture) scheduleSnap();
    else snapCaretOutOfChunk();
  };
  const onTouchMove = () => {
    lastTouchAt = Date.now();
  };
  const onSelectionChange = () => {
    if (composing) return;
    if (touching && Date.now() - lastTouchAt > TOUCH_SILENT_MS) {
      touching = false;
      longGesture = true;
      log(`C 指：離れたと見なした（指の知らせが ${Date.now() - lastTouchAt}ms 来ない）`);
    }
    // ［ルビ］［傍点］を押したときに焦点が外れても使えるように、欄の中の最後の選択を覚える
    const seen = selectionOffsets();
    if (seen) lastSel = seen;
    if (touching || longGesture) logSelectionWhileTouching();
    if (touching) return;
    if (longGesture) {
      scheduleSnap();
      return;
    }
    window.clearTimeout(snapTimer);
    snapTimer = undefined;
    snapCaretOutOfChunk();
  };
  /**
   * 範囲の頭や末が塊の中（書けない所）にあれば、塊ごと選び直す（2026-11-17 iPad の試し9）。
   * 頭が塊の中にあると、iOS は範囲の色を出さず、⌫ も効かなかった
   */
  const widenSelectionOutOfChunks = (range: Range) => {
    if (!element.contains(range.startContainer) || !element.contains(range.endContainer)) return;
    const chunkOf = (node: Node) => (node instanceof Element ? node : node.parentElement)?.closest<HTMLElement>("[data-src]");
    const headChunk = chunkOf(range.startContainer);
    const tailChunk = chunkOf(range.endContainer);
    if (!headChunk && !tailChunk) return;
    const indexIn = (child: Node) => Array.prototype.indexOf.call(element.childNodes, child) as number;
    const start = headChunk ? offsetOf(element, indexIn(headChunk)) : offsetOf(range.startContainer, range.startOffset);
    const end = tailChunk ? offsetOf(element, indexIn(tailChunk) + 1) : offsetOf(range.endContainer, range.endOffset);
    const wide = widenToChunks(tokens, start, end);
    placeRange(wide.start, wide.end);
    log(`C 塊にかかった範囲を塊ごと選び直した：${wide.start}〜${wide.end}字目`);
  };
  const snapCaretOutOfChunk = () => {
    snapTimer = undefined;
    if (composing || touching) return;
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;
    if (!selection.isCollapsed) {
      widenSelectionOutOfChunks(selection.getRangeAt(0));
      return;
    }
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
  /**
   * **塊を押したら、ブラウザに任せず、こちらで塊の前か後ろにカーソルを置く**（2026-11-17 エミュレーター）。
   * 任せると、押した瞬間にカーソルが書けない所（塊の中）へ入り、Android はキーボードを閉じた。
   * mousedown の既定を止めると、選びも焦点も動かない。長押し（選ぶ）は mousedown を出さないので、そのまま
   */
  const chunkAt = (target: EventTarget | null): HTMLElement | undefined => {
    const el = target instanceof Element ? target.closest<HTMLElement>("[data-src]") : null;
    return el && el.parentElement === element ? el : undefined;
  };
  const onMouseDown = (e: MouseEvent) => {
    if (composing || !chunkAt(e.target)) return;
    e.preventDefault();
  };
  /**
   * **塊を2度押したら、塊ごと選ぶ**（2026-11-17 Mac の iPad mini 0.1.73 の試し9後半）。iPad の2度押しは語を選ぶが、
   * 塊（書けない所）の上では選べず、カーソルが塊の前に来るだけだった。塊ごと選べば、終わりのつまみで広げられる。
   * iPad で始めのつまみを塊へ引くと範囲がカーソルに潰れるのは WebKit の側（書けない所を範囲の端にしない）で、ここでは直さない
   */
  const DOUBLE_TAP_MS = 400;
  const selectChunk = (index: number) => {
    const start = offsetOf(element, index);
    const end = offsetOf(element, index + 1);
    if (document.activeElement !== element) element.focus({ preventScroll: true });
    placeRange(start, end);
    log(`C 塊を2度押したので、塊ごと選んだ：${start}〜${end}字目`);
  };
  /** 端末によっては2度目が click で来ず dblclick だけ来るので、こちらでも選ぶ（もう選んでいれば何もしない） */
  const onDblClick = (e: MouseEvent) => {
    const chunk = chunkAt(e.target);
    if (composing || !chunk) return;
    e.preventDefault();
    const index = Array.prototype.indexOf.call(element.childNodes, chunk) as number;
    const sel = selectionOffsets();
    if (sel && sel.start === offsetOf(element, index) && sel.end === offsetOf(element, index + 1)) return;
    selectChunk(index);
  };
  /** 2度押しと見るのは、同じ辺り（この幅の内）を続けて押したときだけ。上と下を続けて押すのは2度押しではない */
  const DOUBLE_TAP_PX = 24;
  let lastChunkClick: { chunk: HTMLElement; at: number; x: number; y: number } | undefined;
  const onClick = (e: MouseEvent) => {
    const chunk = chunkAt(e.target);
    if (composing || !chunk) return;
    const index = Array.prototype.indexOf.call(element.childNodes, chunk) as number;
    const now = Date.now();
    const twice =
      lastChunkClick?.chunk === chunk &&
      now - lastChunkClick.at < DOUBLE_TAP_MS &&
      Math.hypot(e.clientX - lastChunkClick.x, e.clientY - lastChunkClick.y) < DOUBLE_TAP_PX;
    lastChunkClick = twice ? undefined : { chunk, at: now, x: e.clientX, y: e.clientY };
    if (twice) return selectChunk(index);
    const box = chunk.getBoundingClientRect();
    const vertical = getComputedStyle(element).writingMode.startsWith("vertical");
    const before = vertical ? e.clientY < box.top + box.height / 2 : e.clientX < box.left + box.width / 2;
    const offset = offsetOf(element, before ? index : index + 1);
    if (document.activeElement !== element) element.focus({ preventScroll: true });
    placeCaret(offset);
    log(`C 塊を押したので、塊の${before ? "前" : "後ろ"}へカーソルを置いた：${describeCaretAt(tokens, offset)}`);
  };
  /** 押したら、押した所のカーソルの様子を記録に残す（iPad・Android の実機の確かめ） */
  const onPointerUp = (e: PointerEvent) => {
    const point = `${Math.round(e.clientX)}/${Math.round(e.clientY)}`;
    window.setTimeout(() => logCaret(`C 押した（点 ${point}、${e.pointerType}）`), SNAP_SETTLE_MS + 150);
  };
  const onCompStart = () => {
    flushSnap();
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
    paintOwnCaret();
  });

  /**
   * **iPad の縦書きは、カーソルをこちらで描く**（2026-11-17 作者の iPad の写真・作者「カーソルのサイズと位置がおかしいです」：
   * 変換中の字のそばに、横書きの形の縦の棒が列の左に出た。B の欄〈editablePane の ownCaretWhenVertical〉と同じ考え）。
   * ブラウザのカーソルは隠し、前の字の下の辺（無ければ次の字の上の辺）に、列の太さの横の棒を置く。
   * 字の箱から測るので、iOS がカーソルの位置を描き損ねても、字のある所に出る
   */
  let ownCaret: HTMLElement | undefined;
  let ownFrame = 0;
  const ownMode = () => options.ownCaretWhenVertical === true && getComputedStyle(element).writingMode.startsWith("vertical");
  const charBox = (node: Node, from: number): DOMRect | undefined => {
    if (!(node instanceof Text) || from < 0 || from >= node.length || node.data[from] === "​") return undefined;
    const r = document.createRange();
    r.setStart(node, from);
    r.setEnd(node, from + 1);
    const box = r.getBoundingClientRect();
    return box.width > 0 || box.height > 0 ? box : undefined;
  };
  /** カーソルの横の棒の箱（縦書き）。測れなければ undefined（ブラウザのカーソルに任せる） */
  const ownCaretBox = (): { left: number; top: number; width: number } | undefined => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || !selection.isCollapsed) return undefined;
    const node = selection.anchorNode;
    const at = selection.anchorOffset;
    if (!node || !element.contains(node)) return undefined;
    if (node instanceof Text) {
      const before = charBox(node, at - 1);
      if (before) return { left: before.left, top: before.bottom, width: before.width };
      const after = charBox(node, at);
      if (after) return { left: after.left, top: after.top, width: after.width };
    }
    // 字の節の端（塊のすぐ前・すぐ後ろ）：塊の箱の下の辺・上の辺
    const prev = node instanceof Text ? node.previousSibling : node.childNodes[at - 1];
    const next = node instanceof Text ? node.nextSibling : node.childNodes[at];
    if (prev instanceof HTMLElement) {
      const b = prev.getBoundingClientRect();
      return { left: b.left, top: b.bottom, width: b.width };
    }
    if (next instanceof HTMLElement) {
      const b = next.getBoundingClientRect();
      return { left: b.left, top: b.top, width: b.width };
    }
    return undefined;
  };
  const hideOwnCaret = () => {
    ownCaret?.remove();
    ownCaret = undefined;
    element.classList.remove("own-caret-shown");
  };
  const paintOwnCaret = () => {
    if (!options.ownCaretWhenVertical) return;
    cancelAnimationFrame(ownFrame);
    ownFrame = requestAnimationFrame(() => {
      ownFrame = 0;
      const box = document.activeElement === element && ownMode() ? ownCaretBox() : undefined;
      if (!box) return hideOwnCaret();
      const host = element.parentElement ?? document.body;
      if (getComputedStyle(host).position === "static") host.style.position = "relative";
      if (!ownCaret) {
        ownCaret = document.createElement("div");
        ownCaret.className = "own-caret";
        ownCaret.setAttribute("aria-hidden", "true");
        host.appendChild(ownCaret);
      }
      const base = host.getBoundingClientRect();
      ownCaret.style.left = `${box.left - base.left - host.clientLeft + host.scrollLeft}px`;
      ownCaret.style.top = `${box.top - 1 - base.top - host.clientTop + host.scrollTop}px`;
      ownCaret.style.width = `${box.width}px`;
      ownCaret.style.height = "2px";
      element.classList.add("own-caret-shown");
    });
  };
  const onOwnCaretChange = () => paintOwnCaret();
  if (options.ownCaretWhenVertical) {
    document.addEventListener("selectionchange", onOwnCaretChange);
    for (const type of ["input", "compositionupdate", "compositionend", "focus", "blur", "scroll"]) element.addEventListener(type, onOwnCaretChange);
    window.addEventListener("scroll", onOwnCaretChange, { passive: true });
  }

  element.addEventListener("beforeinput", onBeforeInput);
  element.addEventListener("input", onInput);
  element.addEventListener("copy", onCopyEvent);
  element.addEventListener("cut", onCutEvent);
  element.addEventListener("compositionstart", onCompStart);
  element.addEventListener("compositionend", onCompEnd);
  element.addEventListener("pointerup", onPointerUp);
  element.addEventListener("mousedown", onMouseDown);
  element.addEventListener("click", onClick);
  element.addEventListener("dblclick", onDblClick);
  element.addEventListener("touchstart", onTouchStart, { passive: true });
  element.addEventListener("touchmove", onTouchMove, { passive: true });
  element.addEventListener("touchend", onTouchEnd, { passive: true });
  element.addEventListener("touchcancel", onTouchEnd, { passive: true });
  document.addEventListener("selectionchange", onSelectionChange);
  write(text);
  log(composed ? `C 組んだ（塊 ${tokens.filter(isChunk).length}つ）` : "C 記法のまま出した");

  return {
    getText: () => current,
    setText(next) {
      if (next === current && element.childNodes.length > 0) return;
      write(next);
      // 開いたときは本文が空のまま組み、あとから本文が来る端末がある（iPad の 0.1.73 で「塊 0つ」と出た）
      log(composed ? `C 組んだ（塊 ${tokens.filter(isChunk).length}つ）` : "C 記法のまま出した");
      // よそから本文が替わったら、積んだ手は当たらなくなるので捨てる
      settled = current;
      history.clear();
      tellHistory();
    },
    undo: () => step("undo"),
    redo: () => step("redo"),
    canUndo: () => history.canUndo(),
    canRedo: () => history.canRedo(),
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
      if (options.ownCaretWhenVertical) {
        document.removeEventListener("selectionchange", onOwnCaretChange);
        for (const type of ["input", "compositionupdate", "compositionend", "focus", "blur", "scroll"]) element.removeEventListener(type, onOwnCaretChange);
        window.removeEventListener("scroll", onOwnCaretChange);
        cancelAnimationFrame(ownFrame);
        hideOwnCaret();
      }
      element.removeEventListener("beforeinput", onBeforeInput);
      element.removeEventListener("input", onInput);
      element.removeEventListener("copy", onCopyEvent);
      element.removeEventListener("cut", onCutEvent);
      element.removeEventListener("compositionstart", onCompStart);
      element.removeEventListener("compositionend", onCompEnd);
      element.removeEventListener("pointerup", onPointerUp);
      element.removeEventListener("mousedown", onMouseDown);
      element.removeEventListener("click", onClick);
      element.removeEventListener("dblclick", onDblClick);
      element.removeEventListener("touchstart", onTouchStart);
      element.removeEventListener("touchmove", onTouchMove);
      element.removeEventListener("touchend", onTouchEnd);
      element.removeEventListener("touchcancel", onTouchEnd);
      document.removeEventListener("selectionchange", onSelectionChange);
      window.clearTimeout(snapTimer);
      stopWatching();
    },
  };
}

