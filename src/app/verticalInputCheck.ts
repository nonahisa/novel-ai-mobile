/**
 * **打った字が本文へ届いたかの確かめ**（設計書 5.3 の2「打った字が本文へ届いたかを、便ごとに確かめる。食い違いを見つけたら、
 * その場で『この端末では縦書きの入力が崩れることがあります。横で書くと確実です』と出し、［横で書く］へ案内する。
 * **自動では移さない**」・「崩れた組み合わせは端末に覚え、次からは開いたときに一度だけ知らせる（勝手に横へは開かない）」）。
 *
 * - 見るのは、左の線の欄（textarea）で縦書きのときの、変換の確定ごと（`compositionend`）。確定した字（`data`）が、確定のあとの
 *   カーソルのすぐ前に並んでいれば届いた。並んでいなければ食い違い（字が消えた・別の所へ入った）
 * - 確定した字の前後だけを見る。Gboard は既にある語の上で変換をやり直すことがあり（変換の始まりで本文に字がある）、
 *   本文の全体を前と比べると、届いているのに食い違いに見えるため
 * - 中身の無い確定（iOS がもう1つ出す）は見ない
 * - 端末の型と日本語入力の名前はウェブから読めないので、端末に1つの印として覚える（ブラウザの名乗り〈userAgent〉と一緒に。
 *   名乗りが変われば〈端末や OS が替われば〉効かない）
 */

export const VERTICAL_INPUT_BROKEN_KEY = "novelai.verticalInputBroken";
export const VERTICAL_INPUT_MESSAGE = "この端末では縦書きの入力が崩れることがあります。横で書くと確実です";
export const VERTICAL_INPUT_REMINDER = "この端末では、前に縦書きの入力が崩れました。崩れたら［横で書く］で横書きにできます";

/** 確定した字が、確定のあとのカーソルのすぐ前に並んでいるか */
export function committedArrived(value: string, caret: number, data: string): boolean {
  if (!data) return true;
  return caret >= data.length && value.slice(caret - data.length, caret) === data;
}

export interface VerticalInputCheckDeps {
  /** 縦書きのときだけ確かめる */
  vertical(): boolean;
  /** 知らせる（［横で書く］へ案内する） */
  warn(message: string): void;
  storage?: Pick<Storage, "getItem" | "setItem">;
  userAgent?: string;
}

/** 前に崩れたことのある端末か（開いたときに一度だけ知らせるため） */
export function rememberedBroken(storage: Pick<Storage, "getItem"> | undefined, userAgent: string): boolean {
  try {
    return storage?.getItem(VERTICAL_INPUT_BROKEN_KEY) === userAgent;
  } catch {
    return false;
  }
}

/** textarea の確定ごとに確かめる。食い違いは1回の開きにつき1度だけ知らせ、端末に覚える */
export function watchVerticalInput(area: HTMLTextAreaElement, deps: VerticalInputCheckDeps): () => void {
  let warned = false;
  const userAgent = deps.userAgent ?? navigator.userAgent;
  const onEnd = (e: CompositionEvent) => {
    const data = e.data ?? "";
    if (!data || warned || !deps.vertical()) return;
    // 確定の字が入りきってから見る（端末によって compositionend と input の順が違う）
    window.setTimeout(() => {
      if (warned || area.selectionStart !== area.selectionEnd) return;
      if (committedArrived(area.value, area.selectionStart, data)) return;
      warned = true;
      try {
        deps.storage?.setItem(VERTICAL_INPUT_BROKEN_KEY, userAgent);
      } catch {
        /* 覚えられなくても、いまは知らせる */
      }
      deps.warn(VERTICAL_INPUT_MESSAGE);
    }, 0);
  };
  area.addEventListener("compositionend", onEnd);
  return () => area.removeEventListener("compositionend", onEnd);
}
