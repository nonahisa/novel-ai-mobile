import { revealCaret, watchVisibleBand } from "./caretVisible";
import { caretFromPoint, readCharBoxes } from "./tapCaret";
import type { TermSpan } from "./termHighlight";
import {
  applyTextUpdate,
  collapseTo,
  editAtCaret,
  rangeOf,
  selectRange,
  initialPaneState,
  renderPaneHtml,
  type CompositionFormat,
  type Orientation,
  type PaneState,
} from "./editContextModel";

/**
 * B（右傍線）の入力欄。EditContext で IME を受け、字と変換中の線をページが描く。
 * 中身の決まりは `editContextModel.ts`。前の試作（`確認用コピー/縦書きの変換中の線の試作.html` の B）を移した。
 *
 * スマホのソフトキーボードは、削除や改行を `textupdate` で送ってくることも、`keydown` で送ってくることもある
 * （見立て）。両方を受ける。字を押したら、その前後の近いほうへカーソルを置く。
 */

/* EditContext の型（TypeScript の DOM の型に無い版のため、使う所だけ） */
interface EditContextLike extends EventTarget {
  updateText(start: number, end: number, text: string): void;
  updateSelection(start: number, end: number): void;
  updateControlBounds(rect: DOMRect): void;
  updateSelectionBounds(rect: DOMRect): void;
  updateCharacterBounds(start: number, rects: DOMRect[]): void;
}
interface TextUpdateEventLike extends Event {
  updateRangeStart: number;
  updateRangeEnd: number;
  text: string;
  selectionStart: number;
}
interface TextFormatLike {
  rangeStart: number;
  rangeEnd: number;
  underlineStyle: string;
  underlineThickness: string;
}
type EditContextCtor = new (init: { text: string; selectionStart: number; selectionEnd: number }) => EditContextLike;

/** 本文から用語の位置を探す関数（`termHighlight.ts` の `findTermSpans` を索引に結んだもの） */
export type TermFinder = (text: string) => TermSpan[];

export interface EditContextPane {
  getText(): string;
  setText(text: string): void;
  /** 選んでいる範囲（前から後ろへ）。範囲が無ければ始まりと終わりはカーソルの位置（原稿エディターの道具帯で使う） */
  getSelection(): { start: number; end: number };
  /** 範囲を選ぶ（`anchor` は動かない側の端、`focus` は動く側の端。同じならカーソル） */
  setSelection(anchor: number, focus: number): void;
  /** 本文を替え、カーソルを `caret` に置く（道具帯・取り消し） */
  setTextAt(text: string, caret: number): void;
  setOrientation(orientation: Orientation): void;
  /** 用語の探し方を替える（語を打ち直したとき）。描き直す */
  setTerms(find: TermFinder): void;
  focus(): void;
  destroy(): void;
}

/** 入力欄を作る。`onChange` は本文が変わるたびに呼ぶ */
export function mountEditContextPane(
  element: HTMLElement,
  text: string,
  orientation: Orientation,
  onChange: (text: string) => void,
  log: (line: string) => void = () => undefined
): EditContextPane {
  const Ctor = (window as unknown as { EditContext: EditContextCtor }).EditContext;
  let state: PaneState = initialPaneState(text);
  let findTerms: TermFinder = () => [];
  const ec = new Ctor({ text, selectionStart: state.selection, selectionEnd: state.selection });
  /** 選んでいる範囲を EditContext へ伝える（IME は範囲と置き換えて打つ） */
  const tellSelection = () => {
    const { start, end } = rangeOf(state);
    ec.updateSelection(start, end);
  };
  (element as unknown as { editContext: EditContextLike | null }).editContext = ec;
  element.tabIndex = 0;
  element.setAttribute("role", "textbox");
  element.setAttribute("aria-multiline", "true");
  element.classList.add("ec-pane");

  const setOrientation = (next: Orientation) => {
    element.classList.toggle("vertical", next === "vertical");
    element.classList.toggle("horizontal", next === "horizontal");
  };
  setOrientation(orientation);

  const reportBounds = () => {
    ec.updateControlBounds(element.getBoundingClientRect());
    const caret = element.querySelector(".caret");
    if (caret) ec.updateSelectionBounds(caret.getBoundingClientRect());
  };
  const render = () => {
    // 変換中の字も含めた今の本文で探す（確定する前から色が付く。位置がずれない）
    element.innerHTML = renderPaneHtml(state, findTerms(state.text));
    reportBounds();
    // 変換中はページを送らない（見えない受け口と同じ。確定の描き直しで送る）
    if (document.activeElement === element && !state.composing) revealCaret(element.querySelector(".caret"), element);
  };
  // キーボードが出て見える範囲が縮んだら、カーソルを見える所へ送る
  const stopWatching = watchVisibleBand(() => {
    if (document.activeElement === element) {
      reportBounds();
      if (!state.composing) revealCaret(element.querySelector(".caret"), element);
    }
  });
  const changed = () => {
    render();
    onChange(state.text);
  };

  ec.addEventListener("textupdate", (event) => {
    const e = event as TextUpdateEventLike;
    state = applyTextUpdate(state, { start: e.updateRangeStart, end: e.updateRangeEnd, text: e.text, selection: e.selectionStart });
    changed();
  });
  ec.addEventListener("compositionstart", () => {
    state = { ...state, composing: true };
    log("B 変換の始まり");
  });
  ec.addEventListener("compositionend", () => {
    state = { ...state, composing: false, formats: [] };
    log("B 確定");
    render();
  });
  ec.addEventListener("textformatupdate", (event) => {
    const formats = (event as unknown as { getTextFormats(): TextFormatLike[] }).getTextFormats();
    state = {
      ...state,
      formats: formats.map(
        (f): CompositionFormat => ({ start: f.rangeStart, end: f.rangeEnd, style: f.underlineStyle, thickness: f.underlineThickness })
      ),
    };
    log("B 線の形 " + state.formats.map((f) => `[${f.start}-${f.end} ${f.style}/${f.thickness}]`).join(" "));
    render();
  });
  // 候補の窓を変換中の字の横に出すため、字の場所を IME へ返す
  ec.addEventListener("characterboundsupdate", (event) => {
    const e = event as unknown as { rangeStart: number; rangeEnd: number };
    const rects: DOMRect[] = [];
    for (let i = e.rangeStart; i < e.rangeEnd; i++) {
      const span = element.querySelector(`[data-i="${i}"]`);
      rects.push(span ? span.getBoundingClientRect() : new DOMRect());
    }
    ec.updateCharacterBounds(e.rangeStart, rects);
  });

  /** EditContext は改行・削除をしないので、ページが受け持ち、EditContext へも伝える */
  const edit = (kind: "newline" | "backspace" | "delete") => {
    const done = editAtCaret(state, kind);
    if (!done) return;
    state = done.state;
    ec.updateText(done.start, done.end, done.inserted);
    tellSelection();
    changed();
  };
  const moveCaret = (to: number) => {
    state = collapseTo(state, to);
    tellSelection();
    render();
  };
  const setRange = (anchor: number, focus: number) => {
    state = selectRange(state, anchor, focus);
    tellSelection();
    render();
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.isComposing || e.keyCode === 229) return; // 変換中のキーは IME のもの
    const vertical = element.classList.contains("vertical");
    if (e.key === "Backspace") edit("backspace");
    else if (e.key === "Delete") edit("delete");
    else if (e.key === "Enter") edit("newline");
    else if (e.key === (vertical ? "ArrowUp" : "ArrowLeft") || e.key === (vertical ? "ArrowDown" : "ArrowRight")) {
      const step = e.key === (vertical ? "ArrowUp" : "ArrowLeft") ? -1 : 1;
      // Shift を押しながらなら範囲をのばす。押さずに範囲があれば、範囲のその側の端へ
      if (e.shiftKey) setRange(state.anchor, state.selection + step);
      else if (state.anchor !== state.selection) moveCaret(step < 0 ? rangeOf(state).start : rangeOf(state).end);
      else moveCaret(state.selection + step);
    } else return;
    e.preventDefault();
  };
  const onPointerDown = (e: PointerEvent) => {
    // 字の無い所（列の下の端の先など）を押しても、いちばん近い列のその位置へ置く（`tapCaret.ts`）
    const to = caretFromPoint(readCharBoxes(element), e.clientX, e.clientY, element.classList.contains("vertical"));
    if (to !== undefined) moveCaret(to);
  };
  element.addEventListener("keydown", onKeyDown);
  element.addEventListener("pointerdown", onPointerDown);
  element.addEventListener("scroll", reportBounds);
  window.addEventListener("resize", reportBounds);
  render();

  return {
    getText: () => state.text,
    setText(next: string) {
      ec.updateText(0, state.text.length, next);
      state = initialPaneState(next);
      tellSelection();
      render();
    },
    getSelection: () => rangeOf(state),
    setSelection: (anchor, focus) => setRange(anchor, focus),
    setTextAt(next: string, caret: number) {
      ec.updateText(0, state.text.length, next);
      const at = Math.max(0, Math.min(caret, next.length));
      state = collapseTo(initialPaneState(next), at);
      tellSelection();
      render();
    },
    setOrientation(next) {
      setOrientation(next);
      render();
    },
    setTerms(find) {
      findTerms = find;
      render();
    },
    focus: () => element.focus(),
    destroy() {
      element.removeEventListener("keydown", onKeyDown);
      element.removeEventListener("pointerdown", onPointerDown);
      element.removeEventListener("scroll", reportBounds);
      window.removeEventListener("resize", reportBounds);
      stopWatching();
      (element as unknown as { editContext: EditContextLike | null }).editContext = null;
      element.innerHTML = "";
    },
  };
}
