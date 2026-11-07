import { editAtCaret, type Orientation } from "./editContextModel";
import type { EditContextPane } from "./editContextPane";
import {
  SINK_SENTINEL,
  commitSinkValue,
  initialSinkState,
  pageEditFor,
  readSinkValue,
  renderSinkHtml,
  type SinkState,
} from "./imeSinkModel";

/**
 * B（右傍線）の「見えない受け口」の形。iOS（EditContext が無い）で使う。Android でも選べる（比べるため）。
 * 中身の決まりは `imeSinkModel.ts`。
 *
 * - 描く所（`.sink-view`）と、カーソルの位置に重ねる透明な textarea（`.ime-sink`）を同じ箱に置く
 * - 受け口は 16px より大きい字にする（iOS は 16px 未満の欄に焦点が入ると画面を拡大するため）
 * - 受け口は**ほぼ透明**（opacity 0.01）。iOS が自分で描く変換中の色・下線、選択のつまみを見せないため。
 *   ［受け口を見せる］で薄い赤にでき、位置が合っているかを確かめられる
 * - **字を押したら、`click` の処理の中で、何よりも先に同期で受け口へ焦点を移す**。そのあとでカーソルと受け口を動かす。
 *   iOS は、人の操作（タッチの終わり・click）のうちに同期で `focus()` しないとキーボードを出さない。
 *   はじめは `pointerdown` で既定の動きを止めてから焦点を移していて、iOS ではキーボードが出なかった
 *   （2026-11-07 Mac の iOS シミュレーター。動いた受け口そのものを押すと出た）
 * - 受け口にはいつも見えない字（`SINK_SENTINEL`）を1つ入れておき、それが消えたことで「後ろへ消す」を読む
 *   （iOS は受け口が空だと ⌫ の知らせを出さないため）。改行と前へ消すは `beforeinput` で受ける
 */
export function mountImeSinkPane(
  element: HTMLElement,
  text: string,
  orientation: Orientation,
  onChange: (text: string) => void,
  log: (line: string) => void = () => undefined
): EditContextPane & { setShowSink(show: boolean): void } {
  let state: SinkState = initialSinkState(text);
  element.classList.add("ec-pane", "sink-pane");
  element.innerHTML = `<div class="sink-view"></div><textarea class="ime-sink" lang="ja" spellcheck="false" autocapitalize="off" autocomplete="off" autocorrect="off" aria-label="原稿の入力"></textarea>`;
  const view = element.querySelector<HTMLElement>(".sink-view")!;
  const sink = element.querySelector<HTMLTextAreaElement>(".ime-sink")!;

  const setOrientation = (next: Orientation) => {
    element.classList.toggle("vertical", next === "vertical");
    element.classList.toggle("horizontal", next === "horizontal");
  };
  setOrientation(orientation);

  /** 受け口をカーソルの位置へ（変換中は動かさない。動かすと IME の窓や帯が跳ぶ） */
  const placeSink = () => {
    if (state.composing) return;
    const caret = view.querySelector(".caret");
    if (!caret) return;
    const c = caret.getBoundingClientRect();
    const box = element.getBoundingClientRect();
    const lineHeight = parseFloat(getComputedStyle(element).lineHeight) || 34;
    const x0 = box.left + element.clientLeft - element.scrollLeft;
    const y0 = box.top + element.clientTop - element.scrollTop;
    if (element.classList.contains("vertical")) {
      // 縦書きの受け口の1列目（右端の列）を、カーソルの列に重ねる
      const width = sink.offsetWidth || lineHeight;
      sink.style.left = `${c.left + c.width / 2 + lineHeight / 2 - width - x0}px`;
      sink.style.top = `${c.top - y0}px`;
    } else {
      sink.style.left = `${c.left - x0}px`;
      sink.style.top = `${c.top + c.height / 2 - lineHeight / 2 - y0}px`;
    }
  };
  const render = () => {
    view.innerHTML = renderSinkHtml(state);
    placeSink();
  };
  const changed = () => {
    render();
    onChange(state.text);
  };
  /** 受け口を「見えない字が1つ」の状態に戻し、カーソルをそのうしろへ */
  const resetSink = () => {
    sink.value = SINK_SENTINEL;
    if (document.activeElement === sink) sink.setSelectionRange(1, 1);
  };
  /** 受け口の中身を読んで本文に当てる（後ろへ消す・確定した字） */
  const commit = () => {
    const { backspace, inserted } = readSinkValue(sink.value);
    resetSink();
    if (backspace) {
      const done = editAtCaret({ text: state.text, selection: state.selection, composing: false, formats: [] }, "backspace");
      if (done) state = { ...state, text: done.state.text, selection: done.state.selection };
      log("後ろへ消す（受け口の見えない字が消えた）");
    }
    state = commitSinkValue(state, inserted);
    if (inserted) log(`確定「${inserted}」（受け口）`);
    changed();
  };

  sink.addEventListener("compositionstart", () => {
    state = { ...state, composing: true, compText: "" };
    log("変換の始まり（受け口）");
  });
  sink.addEventListener("compositionupdate", (e) => {
    state = { ...state, compText: e.data ?? "" };
    render();
  });
  sink.addEventListener("compositionend", () => {
    // 確定の字が受け口へ入りきるのを待ってから移す（端末によって compositionend と input の順が違う）
    window.setTimeout(() => {
      state = { ...state, composing: false, compText: "" };
      commit();
    }, 0);
  });
  sink.addEventListener("input", (e) => {
    if (!state.composing && !(e as InputEvent).isComposing) commit();
  });
  sink.addEventListener("beforeinput", (e) => {
    const kind = pageEditFor(e.inputType, sink.value, state.composing || e.isComposing);
    if (!kind) return;
    e.preventDefault();
    resetSink();
    const done = editAtCaret({ text: state.text, selection: state.selection, composing: false, formats: [] }, kind);
    if (!done) return;
    state = { ...state, text: done.state.text, selection: done.state.selection };
    changed();
  });
  const moveCaret = (to: number) => {
    state = { ...state, selection: Math.min(Math.max(to, 0), state.text.length) };
    render();
  };
  sink.addEventListener("keydown", (e) => {
    if (e.isComposing || e.keyCode === 229 || sink.value !== SINK_SENTINEL) return;
    const vertical = element.classList.contains("vertical");
    if (e.key === (vertical ? "ArrowUp" : "ArrowLeft")) moveCaret(state.selection - 1);
    else if (e.key === (vertical ? "ArrowDown" : "ArrowRight")) moveCaret(state.selection + 1);
    else return;
    e.preventDefault();
  });
  sink.addEventListener("focus", () => {
    element.classList.add("has-focus");
    if (!state.composing) resetSink();
  });
  sink.addEventListener("blur", () => element.classList.remove("has-focus"));

  const onClick = (e: MouseEvent) => {
    if (e.target === sink) return;
    // 何よりも先に、同期で焦点を移す（iOS がキーボードを出す条件）
    sink.focus({ preventScroll: true });
    if (state.composing) return;
    const span = e.target instanceof Element ? e.target.closest<HTMLElement>("[data-i]") : null;
    if (!span) return;
    const i = Number(span.dataset.i);
    const n = Number(span.dataset.n ?? "1");
    const r = span.getBoundingClientRect();
    const after = element.classList.contains("vertical") ? e.clientY > r.top + r.height / 2 : e.clientX > r.left + r.width / 2;
    moveCaret(after ? i + n : i);
  };
  element.addEventListener("click", onClick);
  element.addEventListener("scroll", placeSink);
  window.addEventListener("resize", placeSink);
  resetSink();
  render();

  return {
    getText: () => state.text,
    setText(next: string) {
      resetSink();
      state = initialSinkState(next);
      render();
    },
    setOrientation(next) {
      setOrientation(next);
      render();
    },
    setShowSink(show: boolean) {
      sink.classList.toggle("show", show);
    },
    focus: () => sink.focus({ preventScroll: true }),
    destroy() {
      element.removeEventListener("click", onClick);
      element.removeEventListener("scroll", placeSink);
      window.removeEventListener("resize", placeSink);
      element.classList.remove("sink-pane", "has-focus");
      element.innerHTML = "";
    },
  };
}
