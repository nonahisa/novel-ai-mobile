import { App } from "@capacitor/app";
import type { FileStore } from "../platform/fileStore";
import type { AutoSaveStatus } from "./autoSave";
import { failureMessage } from "./autoSave";
import { askChoice, askText, tell } from "./dialog";
import { openEpisode, type BackgroundSource, type EpisodeSession } from "./episodeSession";
import { escapeHtml, renderAppBar } from "./menuScreen";
import { TOOL_STRIP, applyRuby, insertText, rubyPlan, toggleEmphasis, wrapBrackets, type TextEdit, type ToolId } from "./manuscriptTools";
import { UndoHistory } from "./undoHistory";
import { Capacitor } from "@capacitor/core";
import { editContextSupport } from "./editContextModel";
import { mountEditContextPane } from "./editContextPane";
import { mountImeSinkPane } from "./imeSinkPane";
import { chooseMergeRegions, finishMerge, planExternalMerge, regionChoices } from "./externalMerge";
import { readTextFile, writeTextFilePreservingFormat } from "../platform/textFile";
import { readWorkLayout, scanWorkFolder } from "../platform/workScan";
import { toStorePath } from "../platform/paths";
import { findTermOccurrences } from "./termOccurrences";
import { readSeriesTerms, readWorkTerms } from "../platform/workTerms";
import { termAtFrom, termFinderFrom, termOnCharFrom, termTagLabel } from "./termHighlight";
import { charFromPoint, readCharBoxes } from "./tapCaret";
import { readProposals, renderProposals, withoutProposal, writeProposals } from "./typoProposals";
import { applyFindingToText } from "../shared";
import { mountRangeGestures } from "./rangeGestures";
import { createTrialLog } from "./trialLogFile";
import { Directory, Encoding, Filesystem } from "@capacitor/filesystem";
import type { TermEntry } from "../shared";
import type { TermFinder } from "./editContextPane";

/**
 * **原稿エディター（C）の土台**：話の一覧から押した話を開いて書く画面（設計書 5.1〜5.4）。
 *
 * - 書く欄は、いまは「書く」面（`<textarea>`。記法をそのまま見せる。設計書 5.1）だけ。組んで書く面と
 *   縦書きの入力の形（A・B・C）は、作者の試し（縦書きの試し）の結果で決める。欄を替える所は {@link mountWritingPane} 1つ
 * - 上のバーの題の下に保存の状態（「保存済み」「保存待ち」「外で変わりました」。5.4）、右に［横で書く］［縦で書く］（5.3 の1）
 * - 保存できなかったとき・外で変わって保存を止めたときは、真ん中の窓で1回だけ知らせる（5.4）
 * - 離れる前に保存を済ませる。済まなければ訊く（書きかけは端末の控えに残っている）
 * - 欄の下（キーボードのすぐ上）に道具帯（設計書 5.6 の案の並び。`manuscriptTools.ts`）。取り消しはアプリが持つ（5.5。
 *   `undoHistory.ts`。ブラウザの取り消しは使わない）
 * - 止められる前の書きかけは、控えたあとで本文が変わっていたときだけ戻すかを訊く（{@link RESTORE_QUESTION}）。
 *   焦点・背景・端末の［戻る］キーは［書きかけを戻す］の側（字を失わない側）
 */

/** 控えたあとで本文がほかで変わっていたとき（2026-11-16 作者の答え「本文が変わったときだけ訊く」） */
export const RESTORE_QUESTION = "書きかけを控えたあとで、この話がほかで変わっています。\n戻さないと、書きかけは消えます";

export type WritingOrientation = "vertical" | "horizontal";

/**
 * 端末のアプリの状態（Capacitor の `appStateChange`）。裏に回ったら知らせる。
 * 聞き手を付ける前に外されても、付いたあとで外す
 */
const appBackground: BackgroundSource = (onBackground) => {
  let detached = false;
  let handle: { remove(): Promise<void> } | undefined;
  App.addListener("appStateChange", ({ isActive }) => {
    if (!isActive) onBackground();
  }).then(
    (h) => {
      if (detached) void h.remove();
      else handle = h;
    },
    () => undefined
  );
  return () => {
    detached = true;
    void handle?.remove();
  };
};

const ORIENTATION_KEY = "novelai.episodeOrientation";

/** 向きは端末ごとに覚える（既定は縦） */
export function parseOrientation(value: string | null): WritingOrientation {
  return value === "horizontal" ? "horizontal" : "vertical";
}
function readOrientation(): WritingOrientation {
  try {
    return parseOrientation(window.localStorage.getItem(ORIENTATION_KEY));
  } catch {
    return "vertical";
  }
}
function writeOrientation(value: WritingOrientation): void {
  try {
    window.localStorage.setItem(ORIENTATION_KEY, value);
  } catch {
    /* 覚えられなくても書ける */
  }
}

/** 上のバーの向きの押し口の字（押すと移る先） */
export function orientationButtonLabel(current: WritingOrientation): string {
  return current === "vertical" ? "横で書く" : "縦で書く";
}

/** 話のファイルの名前から題（`.txt` を除く） */
export function episodeScreenTitle(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  return name.replace(/\.txt$/i, "");
}

/** 道具帯（話を開くまで隠す） */
function renderToolStrip(): string {
  const buttons = TOOL_STRIP.map((tool) => `<button type="button" data-tool="${tool.id}">${escapeHtml(tool.label)}</button>`).join("");
  return `<div class="ms-tools" id="msTools" role="toolbar" aria-label="道具" hidden>${buttons}</div>`;
}

export const EXTERNAL_CHANGE_MESSAGE = "外で変わったので、保存を止めました\n書きかけは残っています";

/** 書く欄（いまは textarea。替えるときはここだけ） */
interface WritingPane {
  setText(text: string): void;
  value(): string;
  selection(): { start: number; end: number };
  /** 道具帯・取り消しで本文を替える（打ったのと同じく onChange へ渡す） */
  apply(edit: TextEdit): void;
  setOrientation(orientation: WritingOrientation): void;
  /** 用語の色（右の線の欄と、色を付ける左の線の欄〈テスト中〉。色を付けない textarea は中の字に色を付けられない） */
  setTerms?(find: TermFinder): void;
  /** カーソルを置いて欄に焦点を当てる（名前が出る行へ飛んだとき）。本文は替えず、手も積まない */
  placeCaret(offset: number): void;
  /**
   * いちばん新しい押しで、指の下にあった字（右の線の欄だけ。字をこの画面が描くので字の四隅が読める）。
   * 字の無い所を押したら `null`。持たない欄（textarea）は、カーソルの位置で札を決める
   */
  pressedChar?(): number | null;
  destroy(): void;
}

function mountWritingPane(
  host: HTMLElement,
  orientation: WritingOrientation,
  onChange: (text: string, kind: "type" | "other") => void,
  colors = false
): WritingPane {
  const area = document.createElement("textarea");
  area.className = `ms-editor ${orientation}`;
  area.id = "msEditor";
  area.lang = "ja";
  area.setAttribute("aria-label", "原稿");
  area.spellcheck = false;
  area.setAttribute("autocapitalize", "off");
  area.setAttribute("autocomplete", "off");
  // 打った字・⌫ の1字消し・変換中の字はまとめてよい手。改行・貼り付けなどはいつも1手
  const onInput = (event: Event) => {
    const type = (event as InputEvent).inputType ?? "";
    const kind = /^(insertText|insertCompositionText|deleteContentBackward|deleteContentForward)$/.test(type) ? "type" : "other";
    onChange(area.value, kind);
  };
  // ブラウザの取り消しは使わない（アプリの手と食い違う。設計書 5.5）
  const onBeforeInput = (event: Event) => {
    const type = (event as InputEvent).inputType;
    if (type === "historyUndo" || type === "historyRedo") event.preventDefault();
  };
  area.addEventListener("input", onInput);
  area.addEventListener("beforeinput", onBeforeInput);
  const backdrop = colors ? mountTermBackdrop(host, area, orientation) : undefined;
  if (!backdrop) host.appendChild(area);
  return {
    setText(text) {
      area.value = text;
      backdrop?.refresh();
    },
    value: () => area.value,
    selection: () => ({ start: area.selectionStart, end: area.selectionEnd }),
    apply(edit) {
      area.value = edit.text;
      area.setSelectionRange(edit.selStart, edit.selEnd);
      backdrop?.refresh();
      onChange(edit.text, "other");
    },
    setOrientation(next) {
      area.classList.toggle("vertical", next === "vertical");
      area.classList.toggle("horizontal", next === "horizontal");
      backdrop?.setOrientation(next);
    },
    ...(backdrop ? { setTerms: (find: TermFinder) => backdrop.setTerms(find) } : {}),
    placeCaret(offset) {
      area.focus();
      area.setSelectionRange(offset, offset);
    },
    destroy() {
      area.removeEventListener("input", onInput);
      area.removeEventListener("beforeinput", onBeforeInput);
      backdrop?.destroy();
      area.remove();
    },
  };
}

/**
 * **左の線の欄に用語の色を付ける層**（2026-11-17 作者の答え「左の欄も作り替える」。設定 → 表示 → 用語の色、テスト中。
 * 引継ぎ書 87章）。
 *
 * 日本語入力はいまと同じ textarea が受ける（変換中の線・カーソル・選び・貼り付けは端末のまま）。textarea の字だけを
 * 透明にし、その裏に同じ字の大きさ・行の折り返しで本文を並べた層を置いて、用語に色を付ける。
 * - 変換中は textarea の字を見せ、裏の層は隠す（変換中の線は字の色で描く端末があるので、透明だと線が消える）
 * - 裏の層は textarea と同じ送り（scrollTop・scrollLeft）に合わせる。送り棒も同じに出して、折り返しの幅をそろえる
 * - 語の探しは本体の索引（`TermFinder`）。本文が替わるたび、次の描きの前に1回だけ並べ直す
 */
function mountTermBackdrop(host: HTMLElement, area: HTMLTextAreaElement, orientation: WritingOrientation) {
  const wrap = document.createElement("div");
  wrap.className = "ms-editor-wrap";
  const back = document.createElement("div");
  back.className = `ms-editor ms-backdrop ${orientation}`;
  back.setAttribute("aria-hidden", "true");
  area.classList.add("ms-editor-over");
  wrap.append(back, area);
  host.appendChild(wrap);
  let find: TermFinder | undefined;
  let frame = 0;
  const paint = () => {
    frame = 0;
    const text = area.value;
    const spans = find ? find(text) : [];
    let html = "";
    let at = 0;
    for (const span of spans) {
      if (span.start < at) continue;
      html += escapeHtml(text.slice(at, span.start));
      html += `<span class="term-${span.kind}">${escapeHtml(text.slice(span.start, span.end))}</span>`;
      at = span.end;
    }
    html += escapeHtml(text.slice(at));
    // 終わりの改行のあとにも行があることを、textarea と同じに見せる
    back.innerHTML = html + (text.endsWith("\n") || text === "" ? "​" : "");
    syncScroll();
  };
  const refresh = () => {
    if (!frame) frame = requestAnimationFrame(paint);
  };
  const syncScroll = () => {
    back.scrollTop = area.scrollTop;
    back.scrollLeft = area.scrollLeft;
  };
  const onCompStart = () => wrap.classList.add("composing");
  const onCompEnd = () => {
    wrap.classList.remove("composing");
    refresh();
  };
  area.addEventListener("input", refresh);
  area.addEventListener("scroll", syncScroll);
  area.addEventListener("compositionstart", onCompStart);
  area.addEventListener("compositionend", onCompEnd);
  const resize = new ResizeObserver(refresh);
  resize.observe(area);
  refresh();
  return {
    refresh,
    setTerms(next: TermFinder) {
      find = next;
      refresh();
    },
    setOrientation(next: WritingOrientation) {
      back.classList.toggle("vertical", next === "vertical");
      back.classList.toggle("horizontal", next === "horizontal");
      refresh();
    },
    destroy() {
      cancelAnimationFrame(frame);
      resize.disconnect();
      area.removeEventListener("input", refresh);
      area.removeEventListener("scroll", syncScroll);
      area.removeEventListener("compositionstart", onCompStart);
      area.removeEventListener("compositionend", onCompEnd);
      area.classList.remove("ms-editor-over");
      wrap.remove();
    },
  };
}

/**
 * **変換中の線**（作者の指示 2026-11-16「傍線は左の方が安定してそうなのでメインにして、右傍線は設定管理でテスト中と断った上で
 * 変更できるように」。設定 → 表示。引継ぎ書 76章）。名前と値は拡張機能（統合）とそろえる：`novelai.compositionLine`＝`left`／`right`、既定 `left`
 *
 * - left：ブラウザの入力欄（textarea）。変換中の線はブラウザが描く（縦書きでは行の左）
 * - right：字と変換中の線をこの画面が描く（13章の B。EditContext、無い端末〈iOS〉は見えない受け口）。線は行の右。
 *   **テスト中**：範囲を選べない（道具帯のルビ・傍点は選んだ字に振れない）、ブラウザの選び・貼り付けの手が弱い
 */
export const COMPOSITION_LINE_KEY = "novelai.compositionLine";
export type CompositionLine = "left" | "right";
export function parseCompositionLine(value: string | null): CompositionLine {
  return value === "right" ? "right" : "left";
}
export function readCompositionLine(): CompositionLine {
  try {
    return parseCompositionLine(window.localStorage.getItem(COMPOSITION_LINE_KEY));
  } catch {
    return "left";
  }
}
/** 左の線の欄にも用語の色を付けるか（テスト中。既定は付けない。2026-11-17 作者の答え。引継ぎ書 87章） */
export const LEFT_LINE_TERM_COLORS_KEY = "novelai.leftLineTermColors";
export function readLeftLineTermColors(): boolean {
  try {
    return window.localStorage.getItem(LEFT_LINE_TERM_COLORS_KEY) === "on";
  } catch {
    return false;
  }
}
export function writeLeftLineTermColors(on: boolean): void {
  try {
    if (on) window.localStorage.setItem(LEFT_LINE_TERM_COLORS_KEY, "on");
    else window.localStorage.removeItem(LEFT_LINE_TERM_COLORS_KEY);
  } catch {
    /* 覚えられなくても、いまの画面は替わる */
  }
}
export function writeCompositionLine(value: CompositionLine): void {
  try {
    window.localStorage.setItem(COMPOSITION_LINE_KEY, value);
  } catch {
    /* 覚えられなくても、いまの画面は替わる */
  }
}

/** 右の線：字と変換中の線をこの画面が描く欄（13章の B）を、原稿エディターの欄の形にする */
function mountRightLinePane(
  host: HTMLElement,
  orientation: WritingOrientation,
  onChange: (text: string, kind: "type" | "other") => void
): WritingPane {
  const element = document.createElement("div");
  element.className = `ms-editor ms-editor-right ${orientation}`;
  element.id = "msEditor";
  element.lang = "ja";
  element.setAttribute("aria-label", "原稿");
  element.dataset.line = "right";
  host.appendChild(element);
  const support = editContextSupport(window, Capacitor.getPlatform());
  const pane = support.ok
    ? mountEditContextPane(element, "", orientation, (text) => onChange(text, "type"))
    : mountImeSinkPane(element, "", orientation, (text) => onChange(text, "type"));
  /** 押し始めの指の下の字（キーボードが出始めると欄が動くので、押し始めで読む。`imeSinkPane.ts` と同じ考え） */
  let pressed: number | null = null;
  const onPressStart = (e: PointerEvent) => {
    pressed = charFromPoint(readCharBoxes(element), e.clientX, e.clientY) ?? null;
  };
  element.addEventListener("pointerdown", onPressStart, true);
  /*
    長押しとつまみで範囲を選ぶ（2026-11-18 作者の答え D）。記録はファイルにも書く（試しの画面と同じ置き場
    `trial-log/`。iOS は Documents。Mac のセッションが取り出す。原稿には書かない）
  */
  const logFile = createTrialLog(new Date(), {
    write: async (logPath, data) => {
      await Filesystem.writeFile({
        path: logPath,
        data,
        directory: Capacitor.getPlatform() === "ios" ? Directory.Documents : Directory.Data,
        encoding: Encoding.UTF8,
        recursive: true,
      });
    },
    setTimer: (fn, ms) => window.setTimeout(fn, ms),
    clearTimer: (handle) => window.clearTimeout(handle as number),
  });
  const log = (line: string) => logFile.add(`${new Date().toLocaleTimeString("ja-JP", { hour12: false })} ${line}`);
  log(`原稿エディター 右の線（${support.ok ? "EditContext" : "受け口"}の作り）`);
  const stopGestures = mountRangeGestures({
    element,
    host,
    text: () => pane.getText(),
    selection: () => pane.getSelection(),
    select: (anchor, focus) => pane.setSelection(anchor, focus),
    composing: () => pane.isComposing(),
    log,
  });
  return {
    pressedChar: () => pressed,
    setText: (text) => pane.setText(text),
    value: () => pane.getText(),
    selection: () => pane.getSelection(),
    apply(edit) {
      pane.setTextAt(edit.text, edit.selEnd);
      onChange(edit.text, "other");
    },
    placeCaret(offset) {
      pane.setTextAt(pane.getText(), offset);
      pane.focus();
    },
    setOrientation(next) {
      element.classList.toggle("vertical", next === "vertical");
      element.classList.toggle("horizontal", next === "horizontal");
      pane.setOrientation(next);
    },
    setTerms: (find) => pane.setTerms(find),
    destroy() {
      element.removeEventListener("pointerdown", onPressStart, true);
      stopGestures();
      void logFile.flush();
      pane.destroy();
      element.remove();
    },
  };
}

/** 画面を離れる前に済ませること（`shell.ts` の LeaveGuard の形） */
export interface EpisodeLeaveGuard {
  isDirty(): boolean;
  /** 保存を済ませ、離れてよいかを返す */
  beforeLeave(): Promise<boolean>;
  destroy(): void;
}

/** 中・広い段の左の話の一覧を開いておくか（端末に覚える。既定は開く） */
export const SIDE_KEY = "novelai.episodeSide";
/** 右の板（提案）を開いているか（中・広い段。設計書 4.3）。はじめは畳んである */
export const BOARD_KEY = "novelai.episodeBoard";
function readBoardOpen(): boolean {
  try {
    return globalThis.localStorage?.getItem(BOARD_KEY) === "open";
  } catch {
    return false;
  }
}
function writeBoardOpen(open: boolean): void {
  try {
    globalThis.localStorage?.setItem(BOARD_KEY, open ? "open" : "closed");
  } catch {
    /* 覚えられなくても、いまの画面は替わる */
  }
}
function readSideOpen(): boolean {
  try {
    return globalThis.localStorage?.getItem(SIDE_KEY) !== "closed";
  } catch {
    return true;
  }
}
function writeSideOpen(open: boolean): void {
  try {
    globalThis.localStorage?.setItem(SIDE_KEY, open ? "open" : "closed");
  } catch {
    /* 覚えられなくても、いまの画面は替わる */
  }
}

export function mountEpisodeScreen(
  screen: HTMLElement,
  store: FileStore,
  path: string,
  options: {
    toast(text: string): void;
    stillHere(): boolean;
    /** 原稿を書く直前（アプリが書いた話の控え。`src/platform/touchedPaths.ts`） */
    beforeWrite?: (path: string) => Promise<void>;
    /** 作品のフォルダー（用語の色の語を、作品の設定資料から作る。設計書 5.7） */
    workRoot?: string;
    /** 同じ作品のほかの話を開き、`offset` にカーソルを置く（名前が出る行へ飛ぶ。保存は離れるときに済ませる） */
    openEpisodeAt?: (path: string, offset: number) => void;
    /** 開いたらカーソルを置く所（`openEpisodeAt` で来たとき） */
    initialCaret?: number;
  }
): EpisodeLeaveGuard {
  let orientation = readOrientation();
  // 幅が 600dp 以上（中・広い段）なら、左に話の一覧（`#msSide`。中身は呼ぶ側が入れる）。段は CSS だけで切り替え、
  // 原稿の欄は作り直さない（回転や分割画面で、書きかけ・カーソル・変換中の字を保つ。設計書 4.3・4.5）
  const sideOpen = readSideOpen();
  const boardOpen = readBoardOpen();
  screen.innerHTML = `${renderAppBar(episodeScreenTitle(path), { back: true, subId: "saveState" })}<div class="ms-layout" id="msLayout" data-side="${sideOpen ? "open" : "closed"}" data-board="${boardOpen ? "open" : "closed"}"><aside class="ms-side" id="msSide" aria-label="話の一覧"></aside><aside class="ms-board" id="msBoard" aria-label="提案"><h2 class="ms-side-title">提案</h2><div id="msBoardBody"></div></aside><div class="ms-main"><div class="ms-host" id="msHost" aria-busy="true"></div><button type="button" class="term-tag" id="termTag" hidden></button>${renderToolStrip()}</div></div><div class="term-sheet" id="termSheet" role="dialog" aria-labelledby="termSheetTitle" hidden><div class="term-sheet-head"><h2 id="termSheetTitle"></h2><button type="button" class="appbar-action" id="termSheetClose">閉じる</button></div><p id="termSheetSummary"></p><ol class="term-hits" id="termSheetHits"></ol></div>`;
  // 上のバーの右に押し口を入れる。［一覧］は中・広い段だけ（CSS で出す）
  const sideToggle = document.createElement("button");
  sideToggle.className = "appbar-action ms-side-toggle";
  sideToggle.id = "sideToggle";
  sideToggle.textContent = "一覧";
  sideToggle.setAttribute("aria-pressed", String(sideOpen));
  sideToggle.addEventListener("click", () => {
    const open = sideToggle.getAttribute("aria-pressed") !== "true";
    sideToggle.setAttribute("aria-pressed", String(open));
    screen.querySelector<HTMLElement>("#msLayout")!.dataset.side = open ? "open" : "closed";
    writeSideOpen(open);
  });
  screen.querySelector<HTMLElement>(".appbar")!.appendChild(sideToggle);
  // ［提案］：右の板（広い段）・右からの引き出し（中の段）。設計書 4.3。左の一覧とは別々に畳む
  const boardToggle = document.createElement("button");
  boardToggle.className = "appbar-action ms-side-toggle";
  boardToggle.id = "boardToggle";
  boardToggle.textContent = "提案";
  boardToggle.setAttribute("aria-pressed", String(boardOpen));
  boardToggle.addEventListener("click", () => {
    const open = boardToggle.getAttribute("aria-pressed") !== "true";
    boardToggle.setAttribute("aria-pressed", String(open));
    screen.querySelector<HTMLElement>("#msLayout")!.dataset.board = open ? "open" : "closed";
    writeBoardOpen(open);
    if (open) paintBoard();
  });
  screen.querySelector<HTMLElement>(".appbar")!.appendChild(boardToggle);
  const toggle = document.createElement("button");
  toggle.className = "appbar-action";
  toggle.id = "orientToggle";
  toggle.textContent = orientationButtonLabel(orientation);
  screen.querySelector<HTMLElement>(".appbar")!.appendChild(toggle);
  const stateEl = screen.querySelector<HTMLElement>("#saveState")!;
  const host = screen.querySelector<HTMLElement>("#msHost")!;
  let session: EpisodeSession | undefined;
  let pane: WritingPane | undefined;
  /**
   * 用語の色（設計書 5.7）：作品の設定資料から語を作り、欄が出てから色を付ける。読むのは画面を開いて1回。
   * 設定が読めなくても色が無いだけで、書くのは止めない（本体の TermHighlighter と同じ）。`設定/` へは書かない
   */
  let termFinder:
    | Promise<
        | {
            find: TermFinder;
            at: (text: string, offset: number) => TermEntry | undefined;
            onChar: (text: string, charIndex: number) => TermEntry | undefined;
            entries: TermEntry[];
          }
        | undefined
      >
    | undefined;
  let termEntries: TermEntry[] = [];
  const applyWorkTerms = () => {
    if (!options.workRoot || !pane?.setTerms) return;
    const root = options.workRoot;
    termFinder ??= (async () => {
      try {
        const layout = await readWorkLayout(store, root);
        // シリーズでつないだ作品の語は自分の語の後ろに積む（同じ所では先に入った自分の資料が勝つ。本体と同じ）
        const own = (await readWorkTerms(store, layout.settings)).entries;
        const entries = [...own, ...(await readSeriesTerms(store, root))];
        return { find: termFinderFrom(entries), at: termAtFrom(entries), onChar: termOnCharFrom(entries), entries };
      } catch {
        return undefined;
      }
    })();
    const target = pane;
    void termFinder.then((terms) => {
      if (terms && pane === target && options.stillHere()) {
        target.setTerms?.(terms.find);
        termAt = terms.at;
        termOnChar = terms.onChar;
        termEntries = terms.entries;
      }
    });
  };
  /**
   * **色の付いた名前を押したときの札**（設計書 5.7【決定】2026-11-15 作者「下に小さい札だけ出す」）。
   * 名前を押すと原稿の下に細い札（「灯（人物）›」）だけを出し、資料はすぐには開かない（カーソルを置くつもりで押しても
   * 原稿が隠れない）。札を押すと資料の紹介を出す（狭い段は下から半分の高さ、中・広い段は右から半分の幅。CSS で切り替え）。
   * 追いかけるのは押したときだけ（打鍵・矢印キーでは追いかけない）。変換中は動かさない。欄の DOM は書き換えない
   */
  let termAt: ((text: string, offset: number) => TermEntry | undefined) | undefined;
  let termOnChar: ((text: string, charIndex: number) => TermEntry | undefined) | undefined;
  let tagged: TermEntry | undefined;
  let composing = false;
  const tag = screen.querySelector<HTMLButtonElement>("#termTag")!;
  const sheet = screen.querySelector<HTMLElement>("#termSheet")!;
  const hideTag = () => {
    tagged = undefined;
    tag.hidden = true;
  };
  const closeSheet = () => {
    sheet.hidden = true;
  };
  // 変換が始まったら札は閉じる（2026-11-18 iPad mini シミュレーター 0.1.86 の試し6：変換中も札が残った）
  host.addEventListener("compositionstart", () => {
    composing = true;
    hideTag();
  });
  host.addEventListener("compositionend", () => (composing = false));
  /*
    押したあとのカーソルで札を出す。pointerup と click の両方で見る：
    - 右の線の欄は押したときに字を描き直すので、押した字が入れ替わり click が欄に届かない（pointerup で見る）
    - 左の線の欄（textarea）は、まだ焦点が無いときの1回目の押しで、pointerup のあとに焦点が来てカーソルが動く
      （2026-11-17 AQUOS：pointerup 97ms・焦点とカーソル 101ms・click 106ms。pointerup だけでは前のカーソルで見て、
      札が出なかった）。click はカーソルが動いたあとに来る
  */
  const checkTag = () => {
    if (composing || !termAt || !pane) return;
    const target = pane;
    const before = target.value();
    setTimeout(() => {
      // 待つあいだに打った字があれば出さない（打つと札は消す）
      if (pane !== target || composing || !termAt || target.value() !== before) return;
      const { start, end } = target.selection();
      // 右の線の欄は、指の下の字で決める（名前の直後＝字と字の境を押しても、名前を押したことにしない）
      const pressed = target.pressedChar?.();
      const entry =
        start !== end ? undefined : pressed === undefined ? termAt(target.value(), start) : pressed === null ? undefined : termOnChar?.(target.value(), pressed);
      if (!entry) return hideTag();
      tagged = entry;
      tag.textContent = `${termTagLabel(entry)} ›`;
      tag.dataset.kind = entry.kind;
      tag.hidden = false;
    }, 0);
  };
  host.addEventListener("pointerup", checkTag);
  host.addEventListener("click", checkTag);
  tag.addEventListener("click", () => {
    if (!tagged) return;
    sheet.querySelector("#termSheetTitle")!.textContent = termTagLabel(tagged);
    const summary = sheet.querySelector<HTMLElement>("#termSheetSummary")!;
    summary.textContent = tagged.summary ?? "";
    summary.hidden = !tagged.summary;
    sheet.hidden = false;
    void listOccurrences(tagged);
  });
  /**
   * 名前が出る話と行（設計書 5.7「資料の側からは、その名前が出る話と行を並べ、押すとその場所へ飛ぶ」）。
   * 開いている話は欄の字（保存前の書きかけも）で、ほかの話は置き場の字で探す。読めない話は飛ばす
   */
  const hitsEl = sheet.querySelector<HTMLOListElement>("#termSheetHits")!;
  let occurrenceRun = 0;
  const listOccurrences = async (entry: TermEntry) => {
    const run = ++occurrenceRun;
    hitsEl.innerHTML = "";
    hitsEl.setAttribute("aria-busy", "true");
    const root = options.workRoot;
    const docs: { path: string; text: string; label: string }[] = [];
    if (root) {
      try {
        for (const episode of (await scanWorkFolder(store, root)).episodes) {
          const episodePath = toStorePath(episode.filePath);
          if (!episodePath) continue;
          const label = episodeScreenTitle(episodePath);
          if (episodePath === path && pane) docs.push({ path: episodePath, text: pane.value(), label });
          else {
            try {
              docs.push({ path: episodePath, text: (await readTextFile(store, episodePath)).text, label });
            } catch {
              /* 読めない話は飛ばす */
            }
          }
        }
      } catch {
        /* 作品が読めなければ、並べないだけ */
      }
    }
    if (run !== occurrenceRun || sheet.hidden) return;
    const labels = new Map(docs.map((doc) => [doc.path, doc.label]));
    const { hits, more } = findTermOccurrences(termEntries, entry.id, docs);
    hitsEl.innerHTML =
      hits
        .map(
          (hit) =>
            `<li><button type="button" data-hit-path="${escapeHtml(hit.path)}" data-hit-offset="${hit.offset}"><span class="term-hit-where">${escapeHtml(labels.get(hit.path) ?? "")}・${hit.line}行</span><span class="term-hit-line">${escapeHtml(hit.excerpt)}</span></button></li>`
        )
        .join("") + (more ? `<li class="term-hits-more">…</li>` : "");
    hitsEl.removeAttribute("aria-busy");
  };
  hitsEl.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLElement>("[data-hit-path]");
    if (!button) return;
    const target = button.dataset.hitPath!;
    const offset = Number(button.dataset.hitOffset);
    closeSheet();
    hideTag();
    if (target === path) pane?.placeCaret(offset);
    else options.openEpisodeAt?.(target, offset);
  });
  sheet.querySelector("#termSheetClose")!.addEventListener("click", closeSheet);
  let destroyed = false;
  const history = new UndoHistory();
  /** 取り消しの手を積むための、ひとつ前の本文 */
  let shown = "";
  const strip = screen.querySelector<HTMLElement>("#msTools")!;
  const button = (id: ToolId) => strip.querySelector<HTMLButtonElement>(`[data-tool="${id}"]`)!;
  const refreshTools = () => {
    button("undo").disabled = !history.canUndo();
    button("redo").disabled = !history.canRedo();
  };
  const onEdit = (text: string, kind: "type" | "other") => {
    hideTag();
    history.record(shown, text, kind, Date.now());
    shown = text;
    session?.edit(text);
    refreshTools();
  };
  // 押しても欄の焦点と選んだ範囲を外さない（選んだ字に振るため）
  strip.addEventListener("pointerdown", (event) => event.preventDefault());
  /*
    右の板の［提案］（設計書 4.3「横の板は［提案］［資料］［メモ］のタブで切り替える。指摘の場所へ、横の板から飛べる」）。
    いまは［提案］だけ（資料は札と紹介、メモはまだ無い）。この話の指摘だけを並べる。
    **［採る］は欄の本文を書き換える**（ファイルへ直に書かない。直に書くと、開いている書きかけと食い違い、
    自動保存が「外で変わった」で止まる）。欄の書き換えは取り消しに積まれ、自動保存が書く。
    行を押すとその行の頭へカーソルを置く
  */
  const boardBody = screen.querySelector<HTMLElement>("#msBoardBody")!;
  const paintBoard = () => {
    boardBody.innerHTML = renderProposals(readProposals(globalThis.localStorage).filter((item) => item.path === path));
  };
  paintBoard();
  boardBody.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    const all = readProposals(globalThis.localStorage);
    const dismiss = target.closest<HTMLElement>("[data-dismiss]")?.dataset.dismiss;
    if (dismiss) {
      writeProposals(globalThis.localStorage, withoutProposal(all, dismiss));
      return paintBoard();
    }
    const accept = target.closest<HTMLElement>("[data-accept]")?.dataset.accept;
    const proposal = all.find((item) => item.id === (accept ?? target.closest<HTMLElement>("[data-proposal]")?.dataset.proposal));
    if (!proposal || !pane) return;
    const text = pane.value();
    if (!accept) {
      // 行の頭へ（行が無ければ何もしない）
      const lines = text.split("\n");
      if (proposal.line < 1 || proposal.line > lines.length) return;
      const offset = lines.slice(0, proposal.line - 1).reduce((sum, line) => sum + line.length + 1, 0);
      pane.placeCaret(offset);
      return;
    }
    if (!proposal.suggestion) return;
    const applied = applyFindingToText(text, proposal);
    writeProposals(globalThis.localStorage, withoutProposal(all, proposal.id));
    if (applied.kind !== "applied") {
      options.toast("本文が変わっていて、直す所が見つかりません。この指摘は外しました");
      return paintBoard();
    }
    const caret = applied.at + proposal.suggestion.length;
    pane.apply({ text: applied.text, selStart: caret, selEnd: caret });
    paintBoard();
  });
  strip.addEventListener("click", (event) => {
    const id = (event.target as HTMLElement).closest<HTMLElement>("[data-tool]")?.dataset.tool as ToolId | undefined;
    if (id && pane) void runTool(id, pane);
  });
  const runTool = async (id: ToolId, target: WritingPane): Promise<void> => {
    const text = target.value();
    const { start, end } = target.selection();
    switch (id) {
      case "undo":
      case "redo": {
        const step = id === "undo" ? history.undo(text) : history.redo(text);
        if (step) {
          shown = step.text;
          target.apply({ text: step.text, selStart: step.caret, selEnd: step.caret });
        }
        // apply は手を積まない（shown を先に合わせた）
        refreshTools();
        return;
      }
      case "brackets":
        return target.apply(wrapBrackets(text, start, end));
      case "dash":
        return target.apply(insertText(text, start, end, "――"));
      case "ellipsis":
        return target.apply(insertText(text, start, end, "……"));
      case "emphasis": {
        const result = toggleEmphasis(text, start, end);
        if (result.ok) target.apply(result.edit);
        else options.toast(result.reason);
        return;
      }
      case "ruby": {
        const plan = rubyPlan(text, start, end);
        if (plan.kind === "none") return options.toast(plan.reason);
        const base = plan.kind === "new" ? plan.base : plan.chunk.base;
        const reading = await askText(`「${base}」の読み`, {
          initial: plan.kind === "edit" ? plan.chunk.reading : "",
          ...(plan.kind === "edit" ? { note: "空にするとルビを外します" } : {}),
          validate: (value) => (plan.kind === "new" && value === "" ? "読みを入れてください" : undefined),
        });
        // 訊いているあいだに本文が替わっていたら振らない（同期・取り消し）
        if (reading === undefined || target.value() !== text) return;
        const result = applyRuby(text, plan, reading);
        if (result.ok) target.apply(result.edit);
        else options.toast(result.reason);
        return;
      }
    }
  };
  const showState = (status: AutoSaveStatus) => {
    stateEl.textContent = status;
    stateEl.dataset.state = status;
  };

  toggle.addEventListener("click", () => {
    orientation = orientation === "vertical" ? "horizontal" : "vertical";
    writeOrientation(orientation);
    toggle.textContent = orientationButtonLabel(orientation);
    pane?.setOrientation(orientation);
  });

  // 捨てる側（［戻さない］）を「はい」に置く。askChoice の焦点・背景は「いいえ」の側
  const confirmRestore = async () => !(await askChoice(RESTORE_QUESTION, "戻さない", "書きかけを戻す"));
  /** 話を開く（はじめと、外の変更と合わせて保存したあとの開き直し） */
  const startSession = () =>
    openEpisode(store, path, {
      confirmRestore,
      background: appBackground,
      ...(options.beforeWrite ? { beforeWrite: options.beforeWrite } : {}),
    }).then((result) => {
      if (destroyed || !options.stillHere()) {
        if (result.ok) result.session.dispose();
        return;
      }
      host.removeAttribute("aria-busy");
      if (!result.ok) {
        pane?.destroy();
        pane = undefined;
        host.innerHTML = `<p class="flag shu long work-warn">${escapeHtml(
          result.reason === "conflict_markers" ? "⚠ 競合が残っているので開けません" : `⚠ 読めませんでした：${result.detail ?? ""}`
        )}</p>`;
        return;
      }
      session = result.session;
      pane ??= readCompositionLine() === "right" ? mountRightLinePane(host, orientation, onEdit) : mountWritingPane(host, orientation, onEdit, readLeftLineTermColors());
      shown = session.text();
      pane.setText(shown);
      if (options.initialCaret !== undefined && options.initialCaret <= shown.length) pane.placeCaret(options.initialCaret);
      applyWorkTerms();
      history.clear();
      strip.hidden = false;
      refreshTools();
      showState(session.status());
      session.onStatusChange((status) => {
        showState(status);
        if (status === "外で変わりました") void mergeExternal();
      });
      session.onFailure((failure) => void tell(failureMessage(failure)));
      if (session.restored) options.toast("保存していない書きかけを戻しました");
    });

  /**
   * 外で変わったとき（引継ぎ書 76章）：最後に保存した本文・書きかけ・入れ替わった本文を段落ごとに比べ、
   * 重ならない所は自動で、重なる所は作者が選んで合わせ、保存して開き直す。合わせられなければ今までどおり止めたまま
   */
  let merging = false;
  const mergeExternal = async () => {
    const current = session;
    if (merging || !current) return;
    merging = true;
    try {
      let external: Awaited<ReturnType<typeof readTextFile>>;
      try {
        external = await readTextFile(store, path);
      } catch {
        return void tell(EXTERNAL_CHANGE_MESSAGE);
      }
      const base = current.baseText();
      const planned = external.hasConflictMarkers ? undefined : planExternalMerge({ base, ours: current.text(), theirs: external.text });
      if (!planned || planned.kind !== "merge") return void tell(EXTERNAL_CHANGE_MESSAGE);
      const choices = regionChoices(planned);
      let picks: number[] = [];
      if (choices.length > 0) {
        const chosen = await chooseMergeRegions(choices);
        // やめたら止めたまま（書きかけは控えに残る）
        if (!chosen || destroyed || session !== current) return;
        picks = chosen.map((which, index) => (which === "ours" ? choices[index]!.ours!.option : choices[index]!.theirs!.option));
      }
      const done = finishMerge(planned, picks, base);
      if (!done.ok) return void tell(EXTERNAL_CHANGE_MESSAGE);
      // 入れ替わった本文を退避に残して書く（ハッシュを照らし、文字コード・改行の形を保つ）
      const written = await writeTextFilePreservingFormat(store, path, done.text, external, external.hash);
      if (!written.ok) return void tell(failureMessage({ reason: written.reason, ...(written.detail !== undefined ? { detail: written.detail } : {}) }));
      if (destroyed) return;
      // 控えを消してから開き直す（合わせた本文がこれからの元になる）
      session = undefined;
      await current.discardDraft();
      current.dispose();
      await startSession();
      options.toast(choices.length > 0 ? "選んだとおりに合わせて保存しました" : "外の変更と合わせて保存しました");
    } finally {
      merging = false;
    }
  };
  void startSession();

  return {
    isDirty: () => session !== undefined && session.status() !== "保存済み",
    async beforeLeave() {
      if (!session) return true;
      const status = await session.flush();
      if (status === "保存済み") return true;
      return askChoice(
        status === "外で変わりました"
          ? "外で変わったので保存していません。書きかけは端末に残っています。戻りますか？"
          : "保存できていません。書きかけは端末に残っています。戻りますか？",
        "戻る",
        "とどまる"
      );
    },
    destroy() {
      destroyed = true;
      session?.dispose();
      pane?.destroy();
    },
  };
}
