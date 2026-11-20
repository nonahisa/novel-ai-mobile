/**
 * **横向きの電話でキーボードが出たら、自動で横書き（閉じると縦書きへ戻る）**（2026-11-19 夜 作者の決定、案2）。
 *
 * 横向きの電話でキーボードを出すと、縦書きの欄が1字ほどの高さになり、帯とつまみが字を覆った（引継ぎ書 130章の気づき・
 * 79章の試し12）。縦書きは列が上から下へ伸びるので、高さが無いと1列に1〜2字しか入らない。
 *
 * - 見るのは「電話（画面の短い辺が 600 未満）・横向き・見える高さが画面の短い辺の 7 割未満（キーボードが出ている）・
 *   原稿の欄に焦点がある」。iPad（短い辺 744 以上）は替えない
 * - **作者の選び（縦・横）は書き換えない。** 見た目だけを替え、条件が外れたら作者の選びへ戻す
 * - 変換中は替えない（打っている最中に面が変わると変換が崩れる。設計書 5.3）。確定してから替える
 * - **見える所がとても低いとき（{@link BARE_MAX_HEIGHT} 未満）は、上のバーも道具帯も隠す**（2026-11-20 夜 作者の答え
 *   「上のバーも道具帯も隠す」。AQUOS の横向きで Gboard が出ると見える高さは 123px で、細いバー 61px と道具帯 52px で尽き、
 *   本文の欄は横書きの1行の上半分しか見えなかった。引継ぎ書 151章の気づき1）。キーボードが閉じれば戻す
 */

export interface ViewSize {
  /** 窓の幅・高さ（CSS の px） */
  width: number;
  height: number;
  /** 画面の幅・高さ（端末の向きに沿う） */
  screenWidth: number;
  screenHeight: number;
  /** キーボードを除いた見える高さ（visualViewport。無ければ窓の高さ） */
  visibleHeight: number;
}

/** 電話とみなす画面の短い辺（設計書 4.1 の狭い段と同じ 600） */
export const PHONE_SHORT_SIDE = 600;
/** キーボードが出ているとみなす、見える高さの割合 */
export const KEYBOARD_RATIO = 0.7;

/**
 * 上のバーと道具帯を隠す、見える高さ（CSS の px）。AQUOS の横向き＋Gboard（123）は隠し、
 * それより高い電話（iPhone の横向き＋キーボードなど）は細くするだけ（`compactMode.ts`）
 */
export const BARE_MAX_HEIGHT = 140;

/** 横向きの電話で、キーボードが出ているか */
export function phoneLandscapeKeyboard(view: ViewSize): boolean {
  const shortSide = Math.min(view.screenWidth, view.screenHeight);
  if (shortSide <= 0 || shortSide >= PHONE_SHORT_SIDE) return false;
  if (view.width <= view.height && view.screenWidth <= view.screenHeight) return false;
  return view.visibleHeight < shortSide * KEYBOARD_RATIO;
}

/** 横向きの電話でキーボードが出ていて、見える所がとても低いか（上のバーも道具帯も隠す） */
export function barelyVisible(view: ViewSize): boolean {
  return phoneLandscapeKeyboard(view) && view.visibleHeight < BARE_MAX_HEIGHT;
}

export interface LandscapeKeyboardDeps {
  /** 原稿の欄（焦点がこの中にあるときだけ） */
  host: HTMLElement;
  /** 自動の横書きを当てる・外す */
  apply(horizontal: boolean): void;
  /** 上のバーと道具帯を隠す・戻す（見える所がとても低いあいだ） */
  bare?(on: boolean): void;
}

function measure(): ViewSize {
  return {
    width: window.innerWidth,
    height: window.innerHeight,
    screenWidth: window.screen?.width ?? 0,
    screenHeight: window.screen?.height ?? 0,
    visibleHeight: window.visualViewport?.height ?? window.innerHeight,
  };
}

/** 見張りを始める。戻り値で止める（止めるときは自動の横書きを外す） */
export function watchLandscapeKeyboard(deps: LandscapeKeyboardDeps): () => void {
  let composing = false;
  let applied = false;
  let bared = false;
  let pending: number | undefined;
  const update = () => {
    pending = undefined;
    if (composing) return;
    const focused = deps.host.contains(document.activeElement);
    const view = measure();
    const want = focused && phoneLandscapeKeyboard(view);
    const wantBare = focused && barelyVisible(view);
    if (wantBare !== bared) {
      bared = wantBare;
      deps.bare?.(wantBare);
    }
    if (want === applied) return;
    applied = want;
    deps.apply(want);
  };
  // キーボードの出入りは何回かに分けて大きさが変わるので、まとめて1回見る
  const soon = () => {
    if (pending === undefined) pending = window.setTimeout(update, 50);
  };
  const onCompStart = () => {
    composing = true;
  };
  const onCompEnd = () => {
    composing = false;
    soon();
  };
  window.visualViewport?.addEventListener("resize", soon);
  window.addEventListener("resize", soon);
  deps.host.addEventListener("focusin", soon);
  deps.host.addEventListener("focusout", soon);
  deps.host.addEventListener("compositionstart", onCompStart);
  deps.host.addEventListener("compositionend", onCompEnd);
  soon();
  return () => {
    window.clearTimeout(pending);
    window.visualViewport?.removeEventListener("resize", soon);
    window.removeEventListener("resize", soon);
    deps.host.removeEventListener("focusin", soon);
    deps.host.removeEventListener("focusout", soon);
    deps.host.removeEventListener("compositionstart", onCompStart);
    deps.host.removeEventListener("compositionend", onCompEnd);
    if (bared) deps.bare?.(false);
    if (applied) deps.apply(false);
  };
}
