import { App } from "@capacitor/app";
import type { FileStore } from "../platform/fileStore";
import type { AutoSaveStatus } from "./autoSave";
import { failureMessage } from "./autoSave";
import { askChoice, askText, tell } from "./dialog";
import { openEpisode, type BackgroundSource, type EpisodeSession } from "./episodeSession";
import { escapeHtml, renderAppBar } from "./menuScreen";
import { TOOL_STRIP, applyRuby, insertText, rubyPlan, toggleEmphasis, wrapBrackets, type TextEdit, type ToolId } from "./manuscriptTools";
import { UndoHistory } from "./undoHistory";

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

/** 画面を離れる前に済ませること（`shell.ts` の LeaveGuard の形） */
export interface EpisodeLeaveGuard {
  isDirty(): boolean;
  /** 保存を済ませ、離れてよいかを返す */
  beforeLeave(): Promise<boolean>;
  destroy(): void;
}

export function mountEpisodeScreen(
  screen: HTMLElement,
  store: FileStore,
  path: string,
  options: { toast(text: string): void; stillHere(): boolean }
): EpisodeLeaveGuard {
  let orientation = readOrientation();
  screen.innerHTML = `${renderAppBar(episodeScreenTitle(path), { back: true, subId: "saveState" })}<div class="ms-host" id="msHost" aria-busy="true"></div>${renderToolStrip()}`;
  // 上のバーの右に押し口を入れる
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
  void openEpisode(store, path, { confirmRestore, background: appBackground }).then((result) => {
    if (destroyed || !options.stillHere()) {
      if (result.ok) result.session.dispose();
      return;
    }
    host.removeAttribute("aria-busy");
    if (!result.ok) {
      host.innerHTML = `<p class="flag shu long work-warn">${escapeHtml(
        result.reason === "conflict_markers" ? "⚠ 競合が残っているので開けません" : `⚠ 読めませんでした：${result.detail ?? ""}`
      )}</p>`;
      return;
    }
    session = result.session;
    pane = mountWritingPane(host, orientation, onEdit);
    shown = session.text();
    pane.setText(shown);
    strip.hidden = false;
    refreshTools();
    showState(session.status());
    session.onStatusChange((status) => {
      showState(status);
      if (status === "外で変わりました") void tell(EXTERNAL_CHANGE_MESSAGE);
    });
    session.onFailure((failure) => void tell(failureMessage(failure)));
    if (session.restored) options.toast("保存していない書きかけを戻しました");
  });

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
