import { Capacitor } from "@capacitor/core";
import { Directory, Encoding, Filesystem } from "@capacitor/filesystem";
import { createTrialLog } from "./trialLogFile";
import { SHARED_VERSION } from "../shared";
import { CapacitorFileStore } from "../platform/capacitorFileStore";
import type { FileStore } from "../platform/fileStore";
import type { TextFileContent } from "../platform/textFile";
import { mountCheckPage } from "./checkPage";
import { editContextSupport, type Orientation } from "./editContextModel";
import { mountEditContextPane, type EditContextPane } from "./editContextPane";
import { mountImeSinkPane } from "./imeSinkPane";
import { mountEditablePane } from "./editablePane";
import { mountComposedPane, type ComposedPane } from "./composedPane";
import {
  SAMPLE_TERM_INPUT,
  TERM_KINDS,
  TERM_KIND_LABELS,
  buildTermIndex,
  findTermSpans,
  termColorCss,
  type TermInput,
} from "./termHighlight";
import { TABS, buildActionList, hiddenActions, searchActions, type PlannedTab } from "./menuPlan";
import { escapeHtml, renderActionRows, renderAppBar, renderTab, renderTabBar } from "./menuScreen";
import {
  DRAFT_PATH,
  SAMPLE_TEXT,
  TRIAL_PREFS_KEY,
  countLabel,
  loadDraft,
  parseTrialPrefs,
  previewHtml,
  saveDraft,
  saveFailureMessage,
  type TrialPrefs,
} from "./tategakiDraft";
import { askChoice } from "./dialog";
import { createDraftJournal, shouldRestore } from "./draftJournal";
import { listWorks, scanWorkFolder, type ScanOptions } from "../platform/workScan";
import { lastCommitTime } from "../platform/git";
import { workSummary } from "./workListView";
import { renderEpisodeList, renderWorkError, renderWorkList } from "./workScreens";
import { mountEpisodeScreen } from "./episodeScreen";

/**
 * アプリの外枠（下のタブ4つと、画面の切り替え）。設計書 4.3 の狭い段。
 *
 * 画面は URL の `#/…` で切り替える（端末の［戻る］で前の画面へ戻れるように）。
 *
 * | `#/works` ほか | 下のタブの画面（`menuPlan.ts` の `TABS`）。［作品］の頭に作品一覧（A） |
 * | `#/work/<作品>` | 話の一覧（B）。下のタブは出したまま、［←］で作品一覧へ |
 * | `#/episode/<作品>/<作品の中の場所>` | 原稿エディター（C）。下のタブを隠し、［←］で話の一覧へ |
 * | `#/all` | すべての機能（検索欄つきの一覧） |
 * | `#/tategaki` | 縦書きの試し |
 * | `#/check` | 動作確認ページ（開発用） |
 *
 * 原稿エディター・縦書きの試し・動作確認ページを開いている間は、下のタブを隠す（4.3「原稿エディターを
 * 開いているあいだ、下のタブは隠してよい」）。上の［←］で戻る。
 */

type Route =
  | { kind: "tab"; tab: PlannedTab }
  | { kind: "work"; root: string }
  | { kind: "episode"; root: string; path: string }
  | { kind: "all" }
  | { kind: "tategaki" }
  | { kind: "check" };

/** 書庫の中の作品は「書庫/作品」。置き場の外や隠したフォルダーは指させない */
function isWorkRoot(root: string): boolean {
  const parts = root.split("/");
  return parts.length <= 2 && parts.every((part) => part !== "" && !part.startsWith("."));
}

/** 作品の中の話の場所。`..`・隠したフォルダー（`.aiwriter`・退避・控え）は指させない */
function isEpisodeInWork(relative: string): boolean {
  const parts = relative.split("/");
  return /\.txt$/i.test(relative) && parts.every((part) => part !== "" && part !== ".." && !part.startsWith("."));
}

export function parseRoute(hash: string): Route {
  const name = hash.replace(/^#\/?/, "");
  if (name.startsWith("episode/")) {
    const pieces = name.slice("episode/".length).split("/");
    try {
      if (pieces.length === 2) {
        const root = decodeURIComponent(pieces[0]!);
        const relative = decodeURIComponent(pieces[1]!);
        if (isWorkRoot(root) && isEpisodeInWork(relative)) return { kind: "episode", root, path: `${root}/${relative}` };
      }
    } catch {
      /* 読めない名前は作品一覧へ */
    }
    return { kind: "tab", tab: TABS[0] };
  }
  if (name === "all") return { kind: "all" };
  if (name === "tategaki") return { kind: "tategaki" };
  if (name === "check") return { kind: "check" };
  if (name.startsWith("work/")) {
    try {
      const root = decodeURIComponent(name.slice("work/".length));
      if (isWorkRoot(root)) return { kind: "work", root };
    } catch {
      /* 読めない名前は作品一覧へ */
    }
    return { kind: "tab", tab: TABS[0] };
  }
  return { kind: "tab", tab: TABS.find((tab) => tab.id === name) ?? TABS[0] };
}

const SCREEN_HASH = { tategaki: "#/tategaki", check: "#/check", allActions: "#/all" } as const;

/** 話の一覧を開く場所 */
export function workHash(root: string): string {
  return `#/work/${encodeURIComponent(root)}`;
}

/** 話を原稿エディターで開く場所。`path` は置き場の根から（`root` の中） */
export function episodeHash(root: string, path: string): string {
  if (!path.startsWith(`${root}/`)) throw new Error(`作品の外の話です: ${path}`);
  return `#/episode/${encodeURIComponent(root)}/${encodeURIComponent(path.slice(root.length + 1))}`;
}

export function mountShell(root: HTMLElement, store: FileStore = new CapacitorFileStore()): void {
  root.innerHTML = `
    <div class="shell">
      <main class="screen" id="screen"></main>
      <nav class="tabbar" id="tabbar" aria-label="下のタブ"></nav>
      <div class="toast" id="toast" role="status" aria-live="polite"></div>
    </div>`;
  // 戻る（history.back）でブラウザが前の送り位置を戻さないように。画面を移るたびに頭から開く（2026-11-07 Mac）
  if ("scrollRestoration" in history) history.scrollRestoration = "manual";
  const screen = root.querySelector<HTMLElement>("#screen")!;
  const tabbar = root.querySelector<HTMLElement>("#tabbar")!;
  const toastEl = root.querySelector<HTMLElement>("#toast")!;
  let toastTimer: number | undefined;
  /** 離れる前に確かめること（縦書きの試しの未保存）と、離れるときの後片付け */
  let leaveGuard: LeaveGuard | undefined;
  /** 「保存しないで戻る」と答えたあとの1回の移動は、確かめずに通す */
  let leaveConfirmed = false;
  /** いちばん最近に開いた下のタブ（［←］はここへ戻る） */
  let lastTabHash = "#/works";
  /** 描くたびに増やす。作品を読み終えたとき、もう別の画面へ移っていたら描かない */
  let renderSeq = 0;
  /**
   * 最後に書いた日は git の最後の版の日（端末の置き場のときだけ。git の置き場も同じ `works` を指す）。
   * 書庫の中の作品（`書庫/作品`）は出さない：書庫は1つのリポジトリなので、最後の版はほかの作品のものかもしれない
   */
  const scanOptions: ScanOptions =
    store instanceof CapacitorFileStore
      ? { lastWrittenOf: async (root) => (root.includes("/") ? undefined : lastCommitTime(`/${root}`)) }
      : {};

  const toast = (text: string) => {
    toastEl.textContent = text;
    toastEl.classList.add("shown");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toastEl.classList.remove("shown"), 2800);
  };

  root.addEventListener("click", (event) => {
    const target = (event.target as HTMLElement).closest<HTMLElement>("[data-screen],[data-planned],[data-tab],[data-back],[data-work],[data-episode]");
    if (!target) return;
    if (target.dataset.episode && target.dataset.root) {
      location.hash = episodeHash(target.dataset.root, target.dataset.episode);
      return;
    }
    if (target.dataset.work) {
      location.hash = workHash(target.dataset.work);
      return;
    }
    if (target.dataset.planned) return toast(target.dataset.planned);
    if (target.dataset.screen) {
      location.hash = SCREEN_HASH[target.dataset.screen as keyof typeof SCREEN_HASH];
      return;
    }
    if (target.dataset.tab) {
      location.hash = `#/${target.dataset.tab}`;
      return;
    }
    if (target.dataset.back !== undefined) {
      /*
        ［←］は、開いていた下のタブへ「移る」（履歴を戻らない）。history.back() で戻ると、iOS は
        scrollRestoration を manual にしても前の送り位置を戻し、［ほか］が前の位置のままだった
        （2026-11-07 Mac H3。すべての機能から戻っても、動作確認ページから戻っても）。
        location.replace なので履歴は増えない
      */
      location.replace(lastTabHash);
    }
  });

  let currentHash = location.hash;
  /** 保存を済ませている最中（重ねて離れようとしても1回だけ） */
  let leaving = false;
  const render = () => {
    if (leaveGuard?.beforeLeave && !leaveConfirmed) {
      // 原稿エディター：URL を戻して保存を済ませ、済んだら（済まなければ訊いて）移る
      const target = location.hash;
      history.replaceState(null, "", currentHash || "#/works");
      if (leaving) return;
      leaving = true;
      void leaveGuard.beforeLeave().then(
        (go) => {
          leaving = false;
          if (!go) return;
          leaveConfirmed = true;
          // 戻るで来た1つ前の履歴へ、積み増さずに移る
          location.replace(target);
        },
        () => {
          leaving = false;
        }
      );
      return;
    }
    if (leaveGuard && leaveGuard.isDirty() && !leaveConfirmed) {
      // いったん URL を元に戻し（描き直さない）、画面の中の日本語のボタンで訊く
      const target = location.hash;
      history.replaceState(null, "", currentHash || "#/works");
      void askChoice("保存していない書き換えがあります。保存しないで戻りますか？", "保存しないで戻る", "とどまる").then((go) => {
        if (!go) return;
        leaveConfirmed = true;
        location.hash = target;
      });
      return;
    }
    leaveConfirmed = false;
    leaveGuard?.destroy();
    leaveGuard = undefined;
    currentHash = location.hash;
    // 前の画面の知らせを次の画面へ持ち越さない
    toastEl.classList.remove("shown");
    const route = parseRoute(location.hash);
    const full = route.kind === "tategaki" || route.kind === "check" || route.kind === "episode";
    tabbar.hidden = full;
    const currentTab =
      route.kind === "tab" ? route.tab.id : route.kind === "work" || route.kind === "episode" ? "works" : route.kind === "all" ? "other" : undefined;
    const seq = ++renderSeq;
    const stillHere = () => seq === renderSeq;
    tabbar.innerHTML = renderTabBar(TABS, currentTab);
    screen.scrollTop = 0;
    // 送っているのはページ（body）なので、移るたびに頭へ戻す（前の画面の送り位置が残っていた。2026-11-07 Mac）
    window.scrollTo(0, 0);
    // iOS は戻ったとき、描き終えたあとで前の送り位置を戻すことがある（scrollRestoration を manual にしても
    // ［ほか］が前の位置のままだった。2026-11-07 Mac D4）。描いたあとでもう一度頭へ
    requestAnimationFrame(() => window.scrollTo(0, 0));
    switch (route.kind) {
      case "tab":
        lastTabHash = `#/${route.tab.id}`;
        screen.innerHTML = renderTab(
          route.tab,
          route.tab.id === "other" ? `モバイル版 ${__APP_VERSION__}（本体の部品 ${SHARED_VERSION}）` : undefined,
          route.tab.id === "works" ? `<div id="workListSlot" aria-busy="true"></div>` : undefined
        );
        if (route.tab.id === "works") mountWorkList(screen.querySelector<HTMLElement>("#workListSlot")!, store, scanOptions, stillHere);
        return;
      case "work":
        lastTabHash = "#/works";
        mountEpisodeList(screen, store, route.root, scanOptions, stillHere);
        return;
      case "episode":
        // ［←］は話の一覧へ（話の一覧の［←］は作品一覧へ）
        lastTabHash = workHash(route.root);
        leaveGuard = mountEpisodeScreen(screen, store, route.path, { toast, stillHere });
        return;
      case "all":
        mountAllActions(screen);
        return;
      case "tategaki":
        leaveGuard = mountTategaki(screen, store);
        return;
      case "check":
        screen.innerHTML = `${renderAppBar("動作確認ページ", { back: true })}<div id="checkRoot"></div>`;
        mountCheckPage(screen.querySelector<HTMLElement>("#checkRoot")!);
        return;
    }
  };
  window.addEventListener("hashchange", render);
  render();
}

/* ---------- 作品一覧（A）と話の一覧（B） ---------- */

/** 作品を読み終えたら一覧を描く（読む間は空の枠のまま） */
function mountWorkList(slot: HTMLElement, store: FileStore, options: ScanOptions, stillHere: () => boolean): void {
  const show = (html: string) => {
    if (!stillHere()) return;
    slot.innerHTML = html;
    slot.removeAttribute("aria-busy");
  };
  listWorks(store, options).then(
    (items) => show(renderWorkList(items, new Date())),
    (error) => show(renderWorkError(error instanceof Error ? error.message : String(error)))
  );
}

/** 話の一覧。題と字数は読み終えてから上のバーへ入れる（読む間はフォルダーの名前） */
function mountEpisodeList(screen: HTMLElement, store: FileStore, root: string, options: ScanOptions, stillHere: () => boolean): void {
  screen.innerHTML = `${renderAppBar(root, { back: true, subId: "workSummary" })}<div id="episodeSlot" aria-busy="true"></div>`;
  const slot = screen.querySelector<HTMLElement>("#episodeSlot")!;
  const show = (html: string) => {
    if (!stillHere()) return;
    slot.innerHTML = html;
    slot.removeAttribute("aria-busy");
  };
  scanWorkFolder(store, root, options).then(
    (work) => {
      if (!stillHere()) return;
      screen.querySelector<HTMLElement>(".appbar-title")!.firstChild!.textContent = work.title;
      screen.querySelector<HTMLElement>("#workSummary")!.textContent = workSummary(work);
      show(renderEpisodeList(work));
    },
    (error) => show(renderWorkError(error instanceof Error ? error.message : String(error)))
  );
}

/* ---------- すべての機能 ---------- */

function mountAllActions(screen: HTMLElement): void {
  const list = buildActionList();
  const hidden = hiddenActions();
  screen.innerHTML = `
    ${renderAppBar("すべての機能", { back: true })}
    <input class="menu-search" id="actionSearch" type="search" placeholder="探す" aria-label="機能を探す" />
    <p class="menu-how" id="actionCount"></p>
    <div id="actionRows"></div>
    <details class="menu-hidden">
      <summary>モバイル版では出さない機能（${hidden.length}件）</summary>
      <ul>${hidden.map((h) => `<li>${escapeHtml(h.label)}：${escapeHtml(h.reason)}</li>`).join("")}</ul>
    </details>`;
  const search = screen.querySelector<HTMLInputElement>("#actionSearch")!;
  const rows = screen.querySelector<HTMLElement>("#actionRows")!;
  const countEl = screen.querySelector<HTMLElement>("#actionCount")!;
  const update = () => {
    const found = searchActions(list, search.value);
    rows.innerHTML = renderActionRows(found);
    countEl.textContent = `${found.length}件`;
  };
  search.addEventListener("input", update);
  update();
}

/* ---------- 縦書き・横書きの試し（A：いまの形・B：右傍線・C：組んで書く） ---------- */

/** 形ごとの1行（2026-11-14 作者の答え「試しの画面の説明も縮める」。設計書 4.6） */
const MODE_NOTES = {
  A: "A：ブラウザの入力欄。変換中の線は左",
  B: "B：字と変換中の線をこの画面が描く（EditContext）。線は右",
  C: "C：ルビ・傍点を組んだまま打つ。ルビ・傍点は1つの塊",
  composeFailed: "C：組めなかったので、記法のまま出しています",
  sink: "B：見えない受け口で受け、字と線をこの画面が描く。線は右",
} as const;

/** 画面を離れる前に確かめること */
interface LeaveGuard {
  /** 保存していない書き換えがあるか */
  isDirty(): boolean;
  /** 離れる前に済ませること（原稿エディターの保存）。在れば isDirty の代わりにこちらで決める */
  beforeLeave?(): Promise<boolean>;
  /** 離れるときの後片付け */
  destroy(): void;
}

/** 選び方を端末の中から読む・書く（読めなくても書けなくても、試しは動く） */
function readTrialPrefs(editContextOk: boolean): TrialPrefs {
  try {
    return parseTrialPrefs(window.localStorage.getItem(TRIAL_PREFS_KEY), editContextOk);
  } catch {
    return parseTrialPrefs(null, editContextOk);
  }
}
function writeTrialPrefs(prefs: TrialPrefs): void {
  try {
    window.localStorage.setItem(TRIAL_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    /* 覚えられなくても、試しは動く */
  }
}

/** 描いて、離れる前に確かめることを返す */
function mountTategaki(screen: HTMLElement, store: FileStore): LeaveGuard {
  const support = editContextSupport(window, Capacitor.getPlatform());
  screen.innerHTML = `
    ${renderAppBar("縦書き・横書きの試し", { back: true, subId: "draftCount" })}
    <div class="seg" role="group" aria-label="向き">
      <button data-orient="vertical" aria-pressed="true">縦書き</button>
      <button data-orient="horizontal" aria-pressed="false">横書き</button>
    </div>
    <div class="seg" role="group" aria-label="入力の形">
      <button data-mode="A" aria-pressed="true">A いまの形</button>
      <button data-mode="B" aria-pressed="false">B 右傍線</button>
      <button data-mode="C" aria-pressed="false">C 組んで書く</button>
    </div>
    <div class="seg" role="group" aria-label="B の受け口" id="sinkSeg" hidden>
      <button data-sink="ec" aria-pressed="true"${support.ok ? "" : " disabled"}>EditContext</button>
      <button data-sink="sink" aria-pressed="false">見えない受け口</button>
    </div>
    ${support.ok ? "" : `<p class="menu-how" id="sinkWhy" hidden>${escapeHtml(support.reason)}</p>`}
    <p class="menu-lead" id="modeNote"></p>
    <div class="seg" role="group" aria-label="道具" id="composedTools" hidden>
      <button id="composedUndo" disabled>取り消し</button>
      <button id="composedRedo" disabled>やり直し</button>
      <button id="composedRuby">ルビ</button>
      <button id="composedEm">傍点</button>
    </div>
    <p class="draft-result" id="composedNote" role="status" hidden></p>
    <div class="draft-input vertical" id="draftInput" lang="ja" aria-label="原稿"></div>
    <div class="draft-input vertical" id="draftPane" lang="ja" aria-label="原稿（右傍線の形）" hidden></div>
    <div class="draft-input composed vertical" id="draftComposed" lang="ja" aria-label="原稿（組んで書く）" hidden></div>
    <div class="draft-actions">
      <button class="primary" id="draftSave">保存して読み戻す</button>
      <button id="draftReload">読み直す</button>
    </div>
    <p class="draft-result" id="draftResult" role="status"></p>
    <details class="menu-hidden term-box" open><summary>色を付ける語（人物・場所・能力・組織）</summary>
      ${TERM_KINDS.map((k) => `<label class="term-row"><span class="term-${k}">${TERM_KIND_LABELS[k]}</span><input class="term-input" data-term="${k}" type="text" lang="ja" autocomplete="off" placeholder="読点で区切る" /></label>`).join("")}
    </details>
    <h2 class="draft-h">ルビと傍点の表示</h2>
    <div class="tategaki-view draft-preview vertical" id="draftPreview"></div>
    <details class="menu-hidden"><summary>変換の知らせの記録</summary>
      <label class="sink-show"><input type="checkbox" id="showSink" /> 見えない受け口を薄い赤で見せる（位置が合っているかを見る）</label>
      <label class="sink-show"><input type="checkbox" id="nativeEnter" /> A の Enter をブラウザに任せる（iPhone でカーソルの印が出るかを比べる）</label>
      <p class="menu-how" id="imeLogFile"></p>
      <pre class="ime-log" id="imeLog"></pre></details>`;
  const input = screen.querySelector<HTMLElement>("#draftInput")!;
  const paneEl = screen.querySelector<HTMLElement>("#draftPane")!;
  const composedEl = screen.querySelector<HTMLElement>("#draftComposed")!;
  let composedPane: ComposedPane | undefined;
  const composedTools = screen.querySelector<HTMLElement>("#composedTools")!;
  const composedNote = screen.querySelector<HTMLElement>("#composedNote")!;
  const tellComposed = (message: string) => {
    composedNote.textContent = message;
  };
  // 押しても欄の焦点と選択を外さない（選んだ字に振るため）
  composedTools.querySelectorAll("button").forEach((b) => b.addEventListener("pointerdown", (e) => e.preventDefault()));
  screen.querySelector<HTMLButtonElement>("#composedRuby")!.addEventListener("click", () => {
    tellComposed("");
    void composedPane?.addRuby(tellComposed);
  });
  screen.querySelector<HTMLButtonElement>("#composedEm")!.addEventListener("click", () => {
    tellComposed("");
    composedPane?.toggleEmphasis(tellComposed);
  });
  const undoButton = screen.querySelector<HTMLButtonElement>("#composedUndo")!;
  const redoButton = screen.querySelector<HTMLButtonElement>("#composedRedo")!;
  undoButton.addEventListener("click", () => {
    tellComposed("");
    composedPane?.undo();
  });
  redoButton.addEventListener("click", () => {
    tellComposed("");
    composedPane?.redo();
  });
  const countEl = screen.querySelector<HTMLElement>("#draftCount")!;
  const preview = screen.querySelector<HTMLElement>("#draftPreview")!;
  const result = screen.querySelector<HTMLElement>("#draftResult")!;
  const noteEl = screen.querySelector<HTMLElement>("#modeNote")!;
  const logEl = screen.querySelector<HTMLElement>("#imeLog")!;
  let loaded: TextFileContent | undefined;
  let savedText: string | undefined;
  let text = "";
  // 前に選んでいた形で開く（2026-11-07 Mac：入り直すと A に戻っていた）
  const prefs = readTrialPrefs(support.ok);
  let orientation: Orientation = prefs.orientation;
  let mode: "A" | "B" | "C" = prefs.mode;
  let pane: (EditContextPane & { setShowSink?(show: boolean): void }) | undefined;
  /** B の受け口。EditContext が無ければ（iOS など）見えない受け口だけ */
  let sinkKind: "ec" | "sink" = prefs.sinkKind;
  const sinkSeg = screen.querySelector<HTMLElement>("#sinkSeg")!;
  const sinkWhy = screen.querySelector<HTMLElement>("#sinkWhy");
  const showSink = screen.querySelector<HTMLInputElement>("#showSink")!;

  // 記録はファイルにも書く（iOS は Documents。Mac のセッションが devicectl で取り出す。trialLogFile.ts）
  const logDirectory = Capacitor.getPlatform() === "ios" ? Directory.Documents : Directory.Data;
  const logFile = createTrialLog(new Date(), {
    write: async (path, data) => {
      await Filesystem.writeFile({ path, data, directory: logDirectory, encoding: Encoding.UTF8, recursive: true });
    },
    setTimer: (fn, ms) => window.setTimeout(fn, ms),
    clearTimer: (handle) => window.clearTimeout(handle as number),
  });
  screen.querySelector<HTMLElement>("#imeLogFile")!.textContent =
    `記録はファイルにも書いています：${logDirectory === Directory.Documents ? "Documents" : "アプリの領域"}/${logFile.path}`;
  const log = (line: string) => {
    const time = new Date().toLocaleTimeString("ja-JP", { hour12: false });
    logFile.add(`${time} ${line}`);
    logEl.textContent = `${time} ${line}\n${logEl.textContent ?? ""}`.slice(0, 12000);
  };
  /** 書きかけの控え（設計書 5.3 の4。止められても次に開いたとき戻す） */
  const journal = createDraftJournal(store, DRAFT_PATH, { onError: (error) => log(`控えを書けなかった：${error instanceof Error ? error.message : String(error)}`) });
  /** 読み終わるまでは控えに触らない（読む前の空の本文で控えを消さない） */
  let journalReady = false;
  const onHidden = () => {
    if (document.visibilityState === "hidden") void journal.flush();
  };
  document.addEventListener("visibilitychange", onHidden);
  const update = () => {
    countEl.textContent = countLabel(text);
    preview.innerHTML = previewHtml(text);
    if (!journalReady) return;
    if (text !== (savedText ?? SAMPLE_TEXT)) journal.note(text);
    else void journal.clear();
  };
  const showText = () => {
    if (mode === "A") editable.setText(text);
    else if (mode === "B") pane?.setText(text);
    else composedPane?.setText(text);
    update();
    noteEl.textContent = modeNote();
  };
  const modeNote = () =>
    mode === "A" ? MODE_NOTES.A : mode === "C" ? (composedPane?.isComposed() === false ? MODE_NOTES.composeFailed : MODE_NOTES.C) : sinkKind === "ec" ? MODE_NOTES.B : MODE_NOTES.sink;
  const applyLayout = () => {
    writeTrialPrefs({ orientation, mode, sinkKind });
    for (const el of [input, paneEl, composedEl, preview]) {
      el.classList.toggle("vertical", orientation === "vertical");
      el.classList.toggle("horizontal", orientation === "horizontal");
    }
    pane?.setOrientation(orientation);
    input.hidden = mode !== "A";
    paneEl.hidden = mode !== "B";
    composedEl.hidden = mode !== "C";
    composedTools.hidden = mode !== "C";
    composedNote.hidden = mode !== "C";
    noteEl.textContent = modeNote();
    sinkSeg.hidden = mode !== "B";
    if (sinkWhy) sinkWhy.hidden = mode !== "B";
    screen
      .querySelectorAll<HTMLButtonElement>("[data-sink]")
      .forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.sink === sinkKind)));
    screen
      .querySelectorAll<HTMLButtonElement>("[data-orient]")
      .forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.orient === orientation)));
    screen
      .querySelectorAll<HTMLButtonElement>("[data-mode]")
      .forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === mode)));
  };

  const editable = mountEditablePane(
    input,
    text,
    (changed) => {
      text = changed;
      update();
    },
    log,
    // iOS の縦書きは、カーソルの印をいつもこちらで描く（2026-11-08 iPad mini：iOS の印が大きくずれた）
    { ownCaretWhenVertical: Capacitor.getPlatform() === "ios" }
  );

  /* 用語の色付け（作者の答え 2026-11-07「両方」）。語を打ち直したら、A・B の両方の探し方を替える */
  ensureTermColorStyle();
  const termInput: TermInput = { ...SAMPLE_TERM_INPUT };
  let findTerms = (_: string) => [] as ReturnType<typeof findTermSpans>;
  const applyTerms = () => {
    const index = buildTermIndex(termInput);
    findTerms = (body: string) => findTermSpans(index, body);
    editable.setTerms(findTerms);
    pane?.setTerms(findTerms);
  };
  screen.querySelectorAll<HTMLInputElement>("[data-term]").forEach((field) => {
    const kind = field.dataset.term as keyof TermInput;
    field.value = termInput[kind];
    field.addEventListener("input", () => {
      termInput[kind] = field.value;
      applyTerms();
    });
  });
  applyTerms();

  screen.querySelectorAll<HTMLButtonElement>("[data-orient]").forEach((button) =>
    button.addEventListener("click", () => {
      orientation = button.dataset.orient as Orientation;
      applyLayout();
    })
  );
  screen.querySelectorAll<HTMLButtonElement>("[data-mode]").forEach((button) =>
    button.addEventListener("click", () => {
      const next = button.dataset.mode as "A" | "B" | "C";
      if (next === mode) return;
      mode = next;
      if (mode === "B" && !pane) mountPane();
      if (mode === "C" && !composedPane) mountComposed();
      applyLayout();
      showText();
    })
  );
  screen.querySelectorAll<HTMLButtonElement>("[data-sink]").forEach((button) =>
    button.addEventListener("click", () => {
      const next = button.dataset.sink as "ec" | "sink";
      if (next === sinkKind || (next === "ec" && !support.ok)) return;
      sinkKind = next;
      pane?.destroy();
      pane = undefined;
      mountPane();
      applyLayout();
      showText();
    })
  );
  showSink.addEventListener("change", () => pane?.setShowSink?.(showSink.checked));
  const nativeEnterBox = screen.querySelector<HTMLInputElement>("#nativeEnter")!;
  nativeEnterBox.addEventListener("change", () => editable.setNativeEnter(nativeEnterBox.checked));

  /** C の入力欄（組んで書く） */
  function mountComposed(): void {
    composedPane = mountComposedPane(
      composedEl,
      text,
      (changed) => {
        text = changed;
        update();
      },
      log,
      (state) => {
        undoButton.disabled = !state.canUndo;
        redoButton.disabled = !state.canRedo;
      }
    );
    undoButton.disabled = true;
    redoButton.disabled = true;
  }

  /** B の入力欄を、選んでいる受け口で作る */
  function mountPane(): void {
    paneEl.className = `draft-input ${orientation}`;
    paneEl.innerHTML = "";
    const onPaneChange = (changed: string) => {
      text = changed;
      update();
    };
    pane =
      sinkKind === "ec"
        ? mountEditContextPane(paneEl, text, orientation, onPaneChange, log)
        : mountImeSinkPane(paneEl, text, orientation, onPaneChange, log);
    pane.setShowSink?.(showSink.checked);
    pane.setTerms(findTerms);
  }

  const load = async () => {
    try {
      loaded = await loadDraft(store);
      text = loaded ? loaded.text.replace(/\n$/, "") : SAMPLE_TEXT;
      savedText = loaded ? text : undefined;
      result.textContent = loaded
        ? `前に保存した原稿を読みました（${loaded.encoding}・${loaded.eol === "\r\n" ? "CRLF" : "LF"}）`
        : "まだ保存していません。見本の文が入っています。";
      // 止められる前の書きかけが控えにあれば戻す
      const kept = await journal.read();
      if (shouldRestore(kept, text)) {
        text = kept;
        result.textContent += "\n保存していない書きかけを戻しました";
        log(`控えから書きかけを戻した（${kept.length}字）`);
      }
    } catch (error) {
      result.textContent = `❌ 読めませんでした：${error instanceof Error ? error.message : String(error)}`;
    }
    journalReady = true;
    showText();
  };

  screen.querySelector<HTMLButtonElement>("#draftSave")!.addEventListener("click", async () => {
    result.textContent = "保存しています…";
    try {
      const saved = await saveDraft(store, text, loaded);
      if (!saved.ok) {
        result.textContent = `❌ ${saveFailureMessage(saved.reason)}`;
        return;
      }
      loaded = saved.readBack;
      savedText = text;
      // 保存が済んだので控えは要らない
      void journal.clear();
      result.textContent = [
        saved.same ? "✅ 保存して読み戻しました。書いた本文と読み戻した本文は同じです" : "❌ 読み戻した本文が、書いた本文と違います",
        `形：${saved.readBack.encoding}・${saved.readBack.eol === "\r\n" ? "CRLF" : "LF"}${saved.created ? "（はじめての保存なので新しく作りました）" : "（前と同じ形で書き戻しました）"}`,
        saved.recoveryPath ? "前の中身の写しを残しました（試し/.novelai-recovery/ の中。本体と同じ決まり）" : "",
      ]
        .filter(Boolean)
        .join("\n");
    } catch (error) {
      result.textContent = `❌ 保存できませんでした：${error instanceof Error ? error.message : String(error)}`;
    }
  });
  screen.querySelector<HTMLButtonElement>("#draftReload")!.addEventListener("click", () => {
    void (async () => {
      if (text !== (savedText ?? SAMPLE_TEXT) && !(await askChoice("保存していない書き換えを捨てて、読み直しますか？", "捨てて読み直す", "やめる"))) return;
      // 捨てると選んだので、控えも捨てる（読み直しで戻さない）
      await journal.clear();
      await load();
    })();
  });

  if (mode === "B") mountPane();
  if (mode === "C") mountComposed();
  applyLayout();
  void load();
  return {
    isDirty: () => text !== (savedText ?? SAMPLE_TEXT),
    destroy() {
      // 離れるのは、保存したか「保存しないで戻る」を選んだとき。どちらも控えは要らない
      // （止められたときは destroy が呼ばれないので、控えが残って次に開いたとき戻る）
      document.removeEventListener("visibilitychange", onHidden);
      void journal.clear();
      pane?.destroy();
      composedPane?.destroy();
      editable.destroy();
    },
  };
}

/** 用語の色（本体の TERM_COLORS から作る CSS）を1回だけ頁に入れる */
function ensureTermColorStyle(): void {
  if (document.getElementById("termColors")) return;
  const style = document.createElement("style");
  style.id = "termColors";
  style.textContent = termColorCss();
  document.head.appendChild(style);
}
