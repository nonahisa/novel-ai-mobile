import {
  applyTextUpdate,
  editAtCaret,
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

export interface EditContextPane {
  getText(): string;
  setText(text: string): void;
  setOrientation(orientation: Orientation): void;
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
  const ec = new Ctor({ text, selectionStart: state.selection, selectionEnd: state.selection });
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
    element.innerHTML = renderPaneHtml(state);
    reportBounds();
  };
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
    ec.updateSelection(state.selection, state.selection);
    changed();
  };
  const moveCaret = (to: number) => {
    state = { ...state, selection: Math.min(Math.max(to, 0), state.text.length) };
    ec.updateSelection(state.selection, state.selection);
    render();
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.isComposing || e.keyCode === 229) return; // 変換中のキーは IME のもの
    const vertical = element.classList.contains("vertical");
    if (e.key === "Backspace") edit("backspace");
    else if (e.key === "Delete") edit("delete");
    else if (e.key === "Enter") edit("newline");
    else if (e.key === (vertical ? "ArrowUp" : "ArrowLeft")) moveCaret(state.selection - 1);
    else if (e.key === (vertical ? "ArrowDown" : "ArrowRight")) moveCaret(state.selection + 1);
    else return;
    e.preventDefault();
  };
  const onPointerDown = (e: PointerEvent) => {
    const span = e.target instanceof Element ? e.target.closest<HTMLElement>("[data-i]") : null;
    if (!span) return;
    const i = Number(span.dataset.i);
    const n = Number(span.dataset.n ?? "1");
    const r = span.getBoundingClientRect();
    const after = element.classList.contains("vertical") ? e.clientY > r.top + r.height / 2 : e.clientX > r.left + r.width / 2;
    moveCaret(after ? i + n : i);
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
      ec.updateSelection(state.selection, state.selection);
      render();
    },
    setOrientation(next) {
      setOrientation(next);
      render();
    },
    focus: () => element.focus(),
    destroy() {
      element.removeEventListener("keydown", onKeyDown);
      element.removeEventListener("pointerdown", onPointerDown);
      element.removeEventListener("scroll", reportBounds);
      window.removeEventListener("resize", reportBounds);
      (element as unknown as { editContext: EditContextLike | null }).editContext = null;
      element.innerHTML = "";
    },
  };
}
