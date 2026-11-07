import { Capacitor } from "@capacitor/core";
import { SHARED_VERSION } from "../shared";
import { CapacitorFileStore } from "../platform/capacitorFileStore";
import type { FileStore } from "../platform/fileStore";
import type { TextFileContent } from "../platform/textFile";
import { mountCheckPage } from "./checkPage";
import { editContextSupport, type Orientation } from "./editContextModel";
import { mountEditContextPane, type EditContextPane } from "./editContextPane";
import { mountImeSinkPane } from "./imeSinkPane";
import { mountEditablePane } from "./editablePane";
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
import { escapeHtml, renderActionRows, renderTab, renderTabBar } from "./menuScreen";
import { SAMPLE_TEXT, countLabel, loadDraft, previewHtml, saveDraft, saveFailureMessage } from "./tategakiDraft";

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
  /** 離れる前に確かめること（縦書きの試しの未保存） */
  let leaveGuard: (() => boolean) | undefined;

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
      if (history.length > 1) history.back();
      else location.hash = "#/works";
    }
  });

  let currentHash = location.hash;
  const render = () => {
    if (leaveGuard && !leaveGuard()) {
      // 離れない：URL を元に戻す（描き直さない）
      history.replaceState(null, "", currentHash || "#/works");
      return;
    }
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
    switch (route.kind) {
      case "tab":
        screen.innerHTML = renderTab(route.tab, `モバイル版 ${__APP_VERSION__}（本体の部品 ${SHARED_VERSION}）`);
        return;
      case "all":
        mountAllActions(screen);
        return;
      case "tategaki":
        leaveGuard = mountTategaki(screen, store);
        return;
      case "check":
        screen.innerHTML = `<header class="appbar"><button class="appbar-back" data-back aria-label="戻る">←</button><span class="appbar-title">動作確認ページ</span></header><div id="checkRoot"></div>`;
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
    <header class="appbar"><button class="appbar-back" data-back aria-label="戻る">←</button><span class="appbar-title">すべての機能</span></header>
    <input class="menu-search" id="actionSearch" type="search" placeholder="2〜3文字で絞る（例：誤字・相関）" aria-label="機能を探す" />
    <p class="menu-how" id="actionCount"></p>
    <div class="menu-items" id="actionRows"></div>
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
    const built = found.filter((e) => e.built).length;
    countEl.textContent = `${found.length}件（作ってあるもの ${built}件）。名前は本体の詳細メニューと同じ字です`;
  };
  search.addEventListener("input", update);
  update();
}

/* ---------- 縦書き・横書きの試し（A：いまの形・B：右傍線） ---------- */

const MODE_NOTES = {
  A: "A：いまの形。入力欄はブラウザのもの（本体の原稿エディターと同じ contenteditable）で、変換中の線もブラウザが描きます（縦書きでは行の左に出ます）。候補の窓は縦になります。",
  B: "B：右傍線の形（EditContext）。字と変換中の線をこの画面が描きます（縦書きでは右、横書きでは下）。文節ごとの太い線・細い線も出ます。入力欄の中ではルビ・傍点は記法の字のまま出ます（下の表示で見られます）。選択・元に戻すはまだありません。",
  sink: "B：右傍線の形（見えない受け口）。カーソルの位置に重ねた透明な欄で日本語入力を受け、字と変換中の線をこの画面が描きます（縦書きでは右、横書きでは下）。線は変換中の字全体に1本で、文節ごとの太い線・細い線は出ません。入力欄の中ではルビ・傍点は記法の字のまま出ます。選択・元に戻すはまだありません。",
} as const;

/** 描いて、離れてよいかを返す関数を渡す */
function mountTategaki(screen: HTMLElement, store: FileStore): () => boolean {
  const support = editContextSupport(window, Capacitor.getPlatform());
  screen.innerHTML = `
    <header class="appbar"><button class="appbar-back" data-back aria-label="戻る">←</button><span class="appbar-title">縦書き・横書きの試し</span></header>
    <div class="seg" role="group" aria-label="向き">
      <button data-orient="vertical" aria-pressed="true">縦書き</button>
      <button data-orient="horizontal" aria-pressed="false">横書き</button>
    </div>
    <div class="seg" role="group" aria-label="入力の形">
      <button data-mode="A" aria-pressed="true">A いまの形（線は左）</button>
      <button data-mode="B" aria-pressed="false">B 右傍線</button>
    </div>
    <div class="seg" role="group" aria-label="B の受け口" id="sinkSeg" hidden>
      <button data-sink="ec" aria-pressed="true"${support.ok ? "" : " disabled"}>EditContext</button>
      <button data-sink="sink" aria-pressed="false">見えない受け口</button>
    </div>
    ${support.ok ? "" : `<p class="menu-how" id="sinkWhy" hidden>${escapeHtml(support.reason)}</p>`}
    <p class="menu-lead" id="modeNote"></p>
    <div class="draft-input vertical" id="draftInput" lang="ja" aria-label="原稿"></div>
    <div class="draft-input vertical" id="draftPane" lang="ja" aria-label="原稿（右傍線の形）" hidden></div>
    <p class="count" id="draftCount"></p>
    <div class="draft-actions">
      <button class="primary" id="draftSave">保存して読み戻す</button>
      <button id="draftReload">読み直す</button>
    </div>
    <p class="draft-result" id="draftResult" role="status"></p>
    <details class="menu-hidden term-box" open><summary>色を付ける語（人物・場所・能力・組織）</summary>
      <p class="menu-how">語を読点（、）で区切って打つと、上の欄の中のその語に色が付きます。「名・姓」のように中黒で区切った名前は、片方だけでも色が付きます（本体と同じ）。作品を開けるようになったら、設定資料の語を使います。</p>
      ${TERM_KINDS.map((k) => `<label class="term-row"><span class="term-${k}">${TERM_KIND_LABELS[k]}</span><input class="term-input" data-term="${k}" type="text" lang="ja" autocomplete="off" /></label>`).join("")}
    </details>
    <h2 class="draft-h">ルビと傍点の表示</h2>
    <p class="menu-how">ルビは {漢字|かんじ}、傍点は {{語}} と打ちます。字数は本体と同じ数え方（改行とルビの読みは数えない）です。</p>
    <div class="tategaki-view draft-preview vertical" id="draftPreview"></div>
    <details class="menu-hidden"><summary>変換の知らせの記録</summary>
      <label class="sink-show"><input type="checkbox" id="showSink" /> 見えない受け口を薄い赤で見せる（位置が合っているかを見る）</label>
      <pre class="ime-log" id="imeLog"></pre></details>`;
  const input = screen.querySelector<HTMLElement>("#draftInput")!;
  const paneEl = screen.querySelector<HTMLElement>("#draftPane")!;
  const countEl = screen.querySelector<HTMLElement>("#draftCount")!;
  const preview = screen.querySelector<HTMLElement>("#draftPreview")!;
  const result = screen.querySelector<HTMLElement>("#draftResult")!;
  const noteEl = screen.querySelector<HTMLElement>("#modeNote")!;
  const logEl = screen.querySelector<HTMLElement>("#imeLog")!;
  let loaded: TextFileContent | undefined;
  let savedText: string | undefined;
  let text = "";
  let orientation: Orientation = "vertical";
  let mode: "A" | "B" = "A";
  let pane: (EditContextPane & { setShowSink?(show: boolean): void }) | undefined;
  /** B の受け口。EditContext が無ければ（iOS など）見えない受け口だけ */
  let sinkKind: "ec" | "sink" = support.ok ? "ec" : "sink";
  const sinkSeg = screen.querySelector<HTMLElement>("#sinkSeg")!;
  const sinkWhy = screen.querySelector<HTMLElement>("#sinkWhy");
  const showSink = screen.querySelector<HTMLInputElement>("#showSink")!;

  const log = (line: string) => {
    const time = new Date().toLocaleTimeString("ja-JP", { hour12: false });
    logEl.textContent = `${time} ${line}\n${logEl.textContent ?? ""}`.slice(0, 3000);
  };
  const update = () => {
    countEl.textContent = countLabel(text);
    preview.innerHTML = previewHtml(text);
  };
  const showText = () => {
    if (mode === "A") editable.setText(text);
    else pane?.setText(text);
    update();
  };
  const applyLayout = () => {
    for (const el of [input, paneEl, preview]) {
      el.classList.toggle("vertical", orientation === "vertical");
      el.classList.toggle("horizontal", orientation === "horizontal");
    }
    pane?.setOrientation(orientation);
    input.hidden = mode !== "A";
    paneEl.hidden = mode !== "B";
    noteEl.textContent = mode === "A" ? MODE_NOTES.A : sinkKind === "ec" ? MODE_NOTES.B : MODE_NOTES.sink;
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
    log
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
      const next = button.dataset.mode as "A" | "B";
      if (next === mode) return;
      mode = next;
      if (mode === "B" && !pane) mountPane();
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
    if (text !== (savedText ?? SAMPLE_TEXT) && !window.confirm("保存していない書き換えを捨てて、読み直しますか？")) return;
    void load();
  });

  applyLayout();
  void load();
  return () => {
    const ok = text === (savedText ?? SAMPLE_TEXT) || window.confirm("保存していない書き換えがあります。保存しないで戻りますか？");
    if (ok) {
      pane?.destroy();
      editable.destroy();
    }
    return ok;
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
