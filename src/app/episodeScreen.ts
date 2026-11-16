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
  destroy(): void;
}

function mountWritingPane(
  host: HTMLElement,
  orientation: WritingOrientation,
  onChange: (text: string, kind: "type" | "other") => void
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
  host.appendChild(area);
  return {
    setText(text) {
      area.value = text;
    },
    value: () => area.value,
    selection: () => ({ start: area.selectionStart, end: area.selectionEnd }),
    apply(edit) {
      area.value = edit.text;
      area.setSelectionRange(edit.selStart, edit.selEnd);
      onChange(edit.text, "other");
    },
    setOrientation(next) {
      area.classList.toggle("vertical", next === "vertical");
      area.classList.toggle("horizontal", next === "horizontal");
    },
    destroy() {
      area.removeEventListener("input", onInput);
      area.removeEventListener("beforeinput", onBeforeInput);
      area.remove();
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
  return {
    setText: (text) => pane.setText(text),
    value: () => pane.getText(),
    selection: () => pane.getSelection(),
    apply(edit) {
      pane.setTextAt(edit.text, edit.selEnd);
      onChange(edit.text, "other");
    },
    setOrientation(next) {
      element.classList.toggle("vertical", next === "vertical");
      element.classList.toggle("horizontal", next === "horizontal");
      pane.setOrientation(next);
    },
    destroy() {
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
  }
): EpisodeLeaveGuard {
  let orientation = readOrientation();
  // 幅が 600dp 以上（中・広い段）なら、左に話の一覧（`#msSide`。中身は呼ぶ側が入れる）。段は CSS だけで切り替え、
  // 原稿の欄は作り直さない（回転や分割画面で、書きかけ・カーソル・変換中の字を保つ。設計書 4.3・4.5）
  const sideOpen = readSideOpen();
  screen.innerHTML = `${renderAppBar(episodeScreenTitle(path), { back: true, subId: "saveState" })}<div class="ms-layout" id="msLayout" data-side="${sideOpen ? "open" : "closed"}"><aside class="ms-side" id="msSide" aria-label="話の一覧"></aside><div class="ms-main"><div class="ms-host" id="msHost" aria-busy="true"></div>${renderToolStrip()}</div></div>`;
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
  const toggle = document.createElement("button");
  toggle.className = "appbar-action";
  toggle.id = "orientToggle";
  toggle.textContent = orientationButtonLabel(orientation);
  screen.querySelector<HTMLElement>(".appbar")!.appendChild(toggle);
  const stateEl = screen.querySelector<HTMLElement>("#saveState")!;
  const host = screen.querySelector<HTMLElement>("#msHost")!;
  let session: EpisodeSession | undefined;
  let pane: WritingPane | undefined;
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
    history.record(shown, text, kind, Date.now());
    shown = text;
    session?.edit(text);
    refreshTools();
  };
  // 押しても欄の焦点と選んだ範囲を外さない（選んだ字に振るため）
  strip.addEventListener("pointerdown", (event) => event.preventDefault());
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
      pane ??= readCompositionLine() === "right" ? mountRightLinePane(host, orientation, onEdit) : mountWritingPane(host, orientation, onEdit);
      shown = session.text();
      pane.setText(shown);
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
