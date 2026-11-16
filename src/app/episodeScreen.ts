import { App } from "@capacitor/app";
import type { FileStore } from "../platform/fileStore";
import type { AutoSaveStatus } from "./autoSave";
import { failureMessage } from "./autoSave";
import { askChoice, tell } from "./dialog";
import { openEpisode, type BackgroundSource, type EpisodeSession } from "./episodeSession";
import { escapeHtml, renderAppBar } from "./menuScreen";

/**
 * **原稿エディター（C）の土台**：話の一覧から押した話を開いて書く画面（設計書 5.1〜5.4）。
 *
 * - 書く欄は、いまは「書く」面（`<textarea>`。記法をそのまま見せる。設計書 5.1）だけ。組んで書く面と
 *   縦書きの入力の形（A・B・C）は、作者の試し（縦書きの試し）の結果で決める。欄を替える所は {@link mountWritingPane} 1つ
 * - 上のバーの題の下に保存の状態（「保存済み」「保存待ち」「外で変わりました」。5.4）、右に［横で書く］［縦で書く］（5.3 の1）
 * - 保存できなかったとき・外で変わって保存を止めたときは、真ん中の窓で1回だけ知らせる（5.4）
 * - 離れる前に保存を済ませる。済まなければ訊く（書きかけは端末の控えに残っている）
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

export const EXTERNAL_CHANGE_MESSAGE = "外で変わったので、保存を止めました\n書きかけは残っています";

/** 書く欄（いまは textarea。替えるときはここだけ） */
interface WritingPane {
  setText(text: string): void;
  setOrientation(orientation: WritingOrientation): void;
  destroy(): void;
}

function mountWritingPane(host: HTMLElement, orientation: WritingOrientation, onChange: (text: string) => void): WritingPane {
  const area = document.createElement("textarea");
  area.className = `ms-editor ${orientation}`;
  area.id = "msEditor";
  area.lang = "ja";
  area.setAttribute("aria-label", "原稿");
  area.spellcheck = false;
  area.setAttribute("autocapitalize", "off");
  area.setAttribute("autocomplete", "off");
  const onInput = () => onChange(area.value);
  area.addEventListener("input", onInput);
  host.appendChild(area);
  return {
    setText(text) {
      area.value = text;
    },
    setOrientation(next) {
      area.classList.toggle("vertical", next === "vertical");
      area.classList.toggle("horizontal", next === "horizontal");
    },
    destroy() {
      area.removeEventListener("input", onInput);
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
  screen.innerHTML = `${renderAppBar(episodeScreenTitle(path), { back: true, subId: "saveState" })}<div class="ms-host" id="msHost" aria-busy="true"></div>`;
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
    pane = mountWritingPane(host, orientation, (text) => session?.edit(text));
    pane.setText(session.text());
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
