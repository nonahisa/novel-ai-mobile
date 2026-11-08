import { revealCaret, watchVisibleBand } from "./caretVisible";
import { caretFromPoint, readCharBoxes } from "./tapCaret";
import { editAtCaret, type Orientation } from "./editContextModel";
import type { EditContextPane, TermFinder } from "./editContextPane";
import {
  SINK_SENTINEL,
  commitSinkValue,
  initialSinkState,
  pageEditFor,
  readSinkValue,
  renderSinkHtml,
  sinkDisplayState,
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
  let findTerms: TermFinder = () => [];
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
  /**
   * **変換しているあいだは、ページを送らない**（確定してから送る）。
   * 押してすぐ打ち始めると、キーボードが出てくる途中で見える範囲が縮み、変換中の字を描くたびにカーソルが
   * 見える範囲の外になって、ページを送っていた。iOS は変換中にページが送られると、変換中の字（「ｋｙ」）を
   * そのまま確定してしまう見込み（2026-11-07 Mac H1：押して1秒たってから打てば崩れなかった）
   */
  const revealWhenSafe = () => {
    // 変換中なら何もしない。確定（compositionend）の描き直しでここへ来るので、そのときに送る
    if (document.activeElement !== sink || state.composing) return;
    revealCaret(view.querySelector(".caret"), element);
  };
  const render = () => {
    // 描くのは変換中の字を挟んだ仮の本文なので、用語もその本文で探す
    view.innerHTML = renderSinkHtml(state, findTerms(sinkDisplayState(state).text));
    placeSink();
    revealWhenSafe();
  };
  const changed = () => {
    render();
    onChange(state.text);
  };
  /**
   * 受け口の中の字のうち、もう本文へ移した数（`readSinkValue`）。
   * **変換しているあいだは受け口の中身に触らない**（iOS は、変換中に中身や選択を書き換えると、変換中の字を
   * そのまま確定してしまう。2026-11-07 Mac：押してすぐ「kyou⏎⏎」と速く打つと、確定のあとに受け口を
   * 空にするのが次の字の変換の途中に当たり、「ｋｙ」が全角の英字で確定し、そのあと変換中の字が残った）
   */
  let consumed = 0;
  /** 受け口を「見えない字が1つ」の状態に戻し、カーソルをそのうしろへ */
  const resetSink = () => {
    // 同じなら書かない（焦点が入った直後に中身や選択を書き換えると、キーボードがつなぎ直し、
    // その間に打った字が変換に入らない。2026-11-07 エミュレーター：押してすぐ打つと「k」だけ英字で入った）
    if (sink.value !== SINK_SENTINEL) sink.value = SINK_SENTINEL;
    consumed = 0;
    if (sink.selectionStart !== 1 || sink.selectionEnd !== 1) sink.setSelectionRange(1, 1);
  };
  /** 受け口の中身を読んで、まだ当てていないことを本文に当て、受け口を空にする（変換していないときだけ） */
  const commit = () => {
    if (state.composing) return;
    const { backspaces, inserted } = readSinkValue(sink.value, consumed);
    resetSink();
    for (let n = 0; n < backspaces; n++) {
      const done = editAtCaret({ text: state.text, selection: state.selection, composing: false, formats: [] }, "backspace");
      if (done) state = { ...state, text: done.state.text, selection: done.state.selection };
      log("後ろへ消す（受け口の字が減った）");
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
  sink.addEventListener("compositionend", (e) => {
    // 確定の字は、その場で data から本文へ移す。受け口を空にするのは、次の変換が始まっていないときだけ
    // （端末によって compositionend と input の順が違うので、少し待ってから受け口の残りを読む）
    const data = e.data ?? "";
    state = commitSinkValue({ ...state, composing: false, compText: "" }, data);
    consumed += data.length;
    if (data) log(`確定「${data}」（受け口）`);
    // 描き直しの中で、待たせていたカーソル送りもする（変換が終わったので）
    changed();
    window.setTimeout(commit, 0);
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
  /** 字を押して焦点を移している最中（焦点の知らせの中では、カーソルを送らない） */
  let focusingFromTap = false;
  sink.addEventListener("focus", () => {
    element.classList.add("has-focus");
    if (!state.composing) resetSink();
    if (!focusingFromTap) revealWhenSafe();
  });
  /**
   * キーボードが出て見える範囲が縮んだら、カーソルを見える所へ送る（iOS では欄がキーボードの下に隠れた）。
   * **変換中なら確定まで待つ**（押してすぐ打ち始めると、キーボードが出きる前に変換が始まる。そこでページを
   * 送ると変換が切れるおそれがある）
   */
  const stopWatching = watchVisibleBand(() => {
    if (document.activeElement !== sink) return;
    placeSink();
    revealWhenSafe();
  });
  sink.addEventListener("blur", () => element.classList.remove("has-focus"));

  /** 押した点から、カーソルを置く位置を読む（字の無い所なら、いちばん近い列のその位置。`tapCaret.ts`） */
  const caretAt = (e: MouseEvent): number | undefined =>
    caretFromPoint(readCharBoxes(view), e.clientX, e.clientY, element.classList.contains("vertical"));
  /**
   * 押した位置は、押し始め（pointerdown）で読んでおく。焦点を移すとキーボードが出始めて欄の位置が変わるので、
   * そのあとで読むと、押した字とずれる（2026-11-07 Mac：「猫」のあたりを押したのに「輩」のうしろに入った）
   */
  let pendingCaret: number | undefined;
  const onPointerDown = (e: PointerEvent) => {
    pendingCaret = e.target === sink || state.composing ? undefined : caretAt(e);
  };
  const onClick = (e: MouseEvent) => {
    if (e.target === sink) return;
    const to = pendingCaret;
    pendingCaret = undefined;
    if (document.activeElement !== sink) {
      /*
        **まだ焦点が無いとき（キーボードが出ていないとき）は、何よりも先に同期で焦点を移す**。
        先に字を描き直して受け口を動かしてから焦点を移すと、iOS は1回目の押しでキーボードを出さず、
        打った字も入らなかった（2026-11-07 Mac #19 I3。焦点を先にしていた #18 では出ていた）。
        焦点の知らせの中のカーソル送りは止める（まだ前のカーソルの所なので、本文の末へ送ってしまう）
      */
      focusingFromTap = true;
      sink.focus({ preventScroll: true });
      focusingFromTap = false;
      if (!state.composing && to !== undefined) moveCaret(to);
      return;
    }
    /*
      もう焦点があるとき（キーボードが出ているとき）は、焦点を移し直さない。カーソルと受け口を動かすだけ。
      受け口の中身と選択は、同じなら書かない（`resetSink`。書き換えると押してすぐ打った字が変換に入らない。
      2026-11-07 Mac H1）
    */
    if (!state.composing) {
      if (to !== undefined) moveCaret(to);
      resetSink();
    }
  };
  element.addEventListener("pointerdown", onPointerDown);
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
    setTerms(find) {
      findTerms = find;
      render();
    },
    setShowSink(show: boolean) {
      sink.classList.toggle("show", show);
    },
    focus: () => sink.focus({ preventScroll: true }),
    destroy() {
      element.removeEventListener("click", onClick);
      element.removeEventListener("pointerdown", onPointerDown);
      stopWatching();
      element.removeEventListener("scroll", placeSink);
      window.removeEventListener("resize", placeSink);
      element.classList.remove("sink-pane", "has-focus");
      element.innerHTML = "";
    },
  };
}
