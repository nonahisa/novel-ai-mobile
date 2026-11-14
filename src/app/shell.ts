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

/**
 * アプリの外枠（下のタブ4つと、画面の切り替え）。設計書 4.3 の狭い段。
 *
 * 画面は URL の `#/…` で切り替える（端末の［戻る］で前の画面へ戻れるように）。
 *
 * | `#/works` ほか | 下のタブの画面（`menuPlan.ts` の `TABS`） |
 * | `#/all` | すべての機能（検索欄つきの一覧） |
 * | `#/tategaki` | 縦書きの試し |
 * | `#/check` | 動作確認ページ（開発用） |
 *
 * 縦書きの試し・動作確認ページを開いている間は、下のタブを隠す（4.3「原稿エディターを
 * 開いているあいだ、下のタブは隠してよい」）。上の［←］で戻る。
 */

type Route = { kind: "tab"; tab: PlannedTab } | { kind: "all" } | { kind: "tategaki" } | { kind: "check" };

export function parseRoute(hash: string): Route {
  const name = hash.replace(/^#\/?/, "");
  if (name === "all") return { kind: "all" };
  if (name === "tategaki") return { kind: "tategaki" };
  if (name === "check") return { kind: "check" };
  return { kind: "tab", tab: TABS.find((tab) => tab.id === name) ?? TABS[0] };
}

const SCREEN_HASH = { tategaki: "#/tategaki", check: "#/check", allActions: "#/all" } as const;

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

  const toast = (text: string) => {
    toastEl.textContent = text;
    toastEl.classList.add("shown");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toastEl.classList.remove("shown"), 2800);
  };

  root.addEventListener("click", (event) => {
    const target = (event.target as HTMLElement).closest<HTMLElement>("[data-screen],[data-planned],[data-tab],[data-back]");
    if (!target) return;
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
  const render = () => {
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
    const full = route.kind === "tategaki" || route.kind === "check";
    tabbar.hidden = full;
    const currentTab = route.kind === "tab" ? route.tab.id : route.kind === "all" ? "other" : undefined;
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
        screen.innerHTML = renderTab(route.tab, route.tab.id === "other" ? `モバイル版 ${__APP_VERSION__}（本体の部品 ${SHARED_VERSION}）` : undefined);
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
    <div class="seg" role="group" aria-label="ルビと傍点" id="composedTools" hidden>
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
  const update = () => {
    countEl.textContent = countLabel(text);
    preview.innerHTML = previewHtml(text);
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
      log
    );
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
    } catch (error) {
      result.textContent = `❌ 読めませんでした：${error instanceof Error ? error.message : String(error)}`;
    }
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
