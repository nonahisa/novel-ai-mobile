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
import { TABS, TRIAL_ITEMS, buildActionList, hiddenActions, searchActions, type PlannedTab } from "./menuPlan";
import { NOT_BUILT_MESSAGE, escapeHtml, itemButton, renderActionRows, renderAppBar, renderTab, renderTabBar } from "./menuScreen";
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
import { askChoice, askText, chooseFrom, tell } from "./dialog";
import { applyBodyFont, parseBodyFont, readBodyFont, renderBodyFontSection, writeBodyFont } from "./bodyFont";
import { renameWork } from "../platform/workRename";
import { checkRemovable, removeWorkFolder } from "../platform/workRemove";
import { watchLongPress } from "./longPress";
import { mountOrphanDrafts } from "./orphanDrafts";
import { createDraftJournal, shouldRestore } from "./draftJournal";
import { listWorks, readWorkLayout, scanWorkFolder, type ScanOptions } from "../platform/workScan";
import { lastCommitTime } from "../platform/git";
import { dayLabel, syncFlag, workSummary } from "./workListView";
import { createGitFs, CapacitorGitFsBackend } from "../platform/gitFs";
import { latestUnsentTime, readWorkSync, workRepo, type WorkSyncState } from "../platform/workSync";
import { renderEpisodeList, renderWorkError, renderWorkList } from "./workScreens";
import { mountEpisodeScreen, readCompositionLine, readLeftLineTermColors, writeCompositionLine, writeLeftLineTermColors } from "./episodeScreen";
import { renderSyncScreen, type SyncAccess, type SyncConflictRow } from "./syncScreen";
import { applyFailureText, renderConflictView, theirsQuestion, type ConflictView } from "./conflictScreen";
import type { ConflictChoice, ConflictMaterial } from "../platform/syncConflict";
import { fetchGithubLogin, pickGithubClientId, mountGithubScreen, readGithubUser, writeGithubUser } from "./githubScreen";
import { createTouchedRecorder } from "../platform/touchedPaths";
import { createAutoFetch } from "./autoFetch";
import { createNewWork, newWorkResultText, repoNameProblem } from "../platform/newWork";
import { DeviceFontShelf } from "../platform/fontShelf";
import { CLOUD_PROVIDERS, checkApiKey, keyCheckText, saveApiKey, validateApiKeyFormat, type CloudProviderId } from "../platform/aiKeys";
import { keyPrompt, removeQuestion, renderAiScreen, renderAssignmentSections, renderKeyRows, type KeyRow } from "./aiScreen";
import { PAID_ASSIGN_NOTICE, describeChoice, featureRows, readAiChoices, saveDefaultChoice, saveFeatureChoice } from "../platform/aiAssignment";
import { DeviceSettings, capacitorPreferencesBackend } from "../platform/deviceSettings";
import type { AssignableFeature } from "../shared";
import { MINCHO_FONT, downloadFont, readVerifiedFont, useFont } from "../platform/fontDownload";
import { FONT_FAILURE, renderDisplayScreen, renderFontRow, renderLicenses, renderLineSection, type FontView } from "./displayScreen";
import { importWork, listGithubRepos, progressLabel, type GithubRepo } from "../platform/workImport";
import { importResultText, renderImportView, type ImportView } from "./importScreen";
import { DeviceSecretVault, GITHUB_TOKEN_SECRET, MemorySecretVault, type SecretVault } from "../platform/secretVault";
import {
  chooseConflict,
  fetchWork,
  githubIdentity,
  listConflicts,
  outcomeText,
  pushMessage,
  readConflictMaterial,
  readRepoTarget,
  sendWork,
} from "../platform/workSyncRun";
import { nativePostForm } from "../platform/githubDeviceFlow";
import { applyLook, parseLook, readLook, renderLookSection, writeLook } from "./look";
import { readProposals, renderProposals, renderTypoEntry, withoutProposal, writeProposals, type TypoProposal } from "./typoProposals";
import { mountTypoRun } from "./typoScreen";
import { mountSynopsisRun } from "./synopsisScreen";
import { applyOutcomeText, applyProposal } from "../platform/applyProposal";
import { readLastEpisode, readRecentEpisodes, rememberLastEpisode, renderWriteLead, type LastEpisode } from "./lastEpisode";

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
 * | `#/github` | GitHub と同期（サインイン） |
 * | `#/import` | GitHub から取り寄せる |
 * | `#/display` | 表示（書体の取り寄せ） |
 * | `#/licenses` | ライセンス |
 * | `#/ai` | 設定 → AI（クラウドの AI の鍵） |
 * | `#/drafts` | 設定 → 書きかけの控え（どの話にも合わない控えを見て消す） |
 * | `#/check` | 動作確認ページ（開発用） |
 *
 * 原稿エディター・縦書きの試し・動作確認ページを開いている間は、下のタブを隠す（4.3「原稿エディターを
 * 開いているあいだ、下のタブは隠してよい」）。上の［←］で戻る。
 */

type Route =
  | { kind: "tab"; tab: PlannedTab }
  | { kind: "work"; root: string }
  | { kind: "sync"; root: string }
  | { kind: "conflict"; root: string; path: string }
  | { kind: "episode"; root: string; path: string }
  /** AI で1話を見る（誤字脱字・推敲）。見積もり → 有料の確認 → 指摘は［提案］へ */
  | { kind: "typo"; check: "typo" | "proofread"; root: string; path: string }
  /** 各話あらすじ（話の長押し → あらすじ。台帳へ書く） */
  | { kind: "synopsis"; root: string; path: string }
  | { kind: "all" }
  | { kind: "tategaki" }
  | { kind: "check" }
  | { kind: "github" }
  | { kind: "import" }
  | { kind: "display" }
  | { kind: "licenses" }
  | { kind: "ai" }
  | { kind: "drafts" };

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
  if (name.startsWith("synopsis/")) {
    const pieces = name.slice("synopsis/".length).split("/");
    try {
      if (pieces.length === 2) {
        const root = decodeURIComponent(pieces[0]!);
        const relative = decodeURIComponent(pieces[1]!);
        if (isWorkRoot(root) && isEpisodeInWork(relative)) return { kind: "synopsis", root, path: `${root}/${relative}` };
      }
    } catch {
      /* 読めない名前は作品一覧へ */
    }
    return { kind: "tab", tab: TABS[0] };
  }
  if (name.startsWith("typo/") || name.startsWith("proofread/")) {
    const check = name.startsWith("typo/") ? "typo" : "proofread";
    const pieces = name.slice(`${check}/`.length).split("/");
    try {
      if (pieces.length === 2) {
        const root = decodeURIComponent(pieces[0]!);
        const relative = decodeURIComponent(pieces[1]!);
        if (isWorkRoot(root) && isEpisodeInWork(relative)) return { kind: "typo", check, root, path: `${root}/${relative}` };
      }
    } catch {
      /* 読めない名前は作品一覧へ */
    }
    return { kind: "tab", tab: TABS[0] };
  }
  if (name === "all") return { kind: "all" };
  if (name === "tategaki") return { kind: "tategaki" };
  if (name === "check") return { kind: "check" };
  if (name === "github") return { kind: "github" };
  if (name === "import") return { kind: "import" };
  if (name === "display") return { kind: "display" };
  if (name === "licenses") return { kind: "licenses" };
  if (name === "ai") return { kind: "ai" };
  if (name === "drafts") return { kind: "drafts" };
  if (name.startsWith("conflict/")) {
    const pieces = name.slice("conflict/".length).split("/");
    try {
      if (pieces.length === 2) {
        const root = decodeURIComponent(pieces[0]!);
        const path = decodeURIComponent(pieces[1]!);
        const parts = path.split("/");
        if (isWorkRoot(root) && parts.every((part) => part !== "" && part !== ".." && !part.startsWith("."))) return { kind: "conflict", root, path };
      }
    } catch {
      /* 読めない名前は作品一覧へ */
    }
    return { kind: "tab", tab: TABS[0] };
  }
  if (name.startsWith("sync/")) {
    try {
      const root = decodeURIComponent(name.slice("sync/".length));
      if (isWorkRoot(root)) return { kind: "sync", root };
    } catch {
      /* 読めない名前は作品一覧へ */
    }
    return { kind: "tab", tab: TABS[0] };
  }
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

const SCREEN_HASH = { tategaki: "#/tategaki", check: "#/check", allActions: "#/all", github: "#/github", import: "#/import", display: "#/display", licenses: "#/licenses", ai: "#/ai", drafts: "#/drafts", proposals: "#/proposals" } as const;

/**
 * 鍵の置き場。端末では Keystore／Keychain。ブラウザ（画面のテスト）では手元だけ（開いているあいだ）。
 * Client ID は、ブラウザのときだけテストが `__novelaiTestGithubClientId` で差し込める（端末では使わない）
 */
let vault: SecretVault | undefined;
function secretVault(): SecretVault {
  vault ??= Capacitor.isNativePlatform() ? new DeviceSecretVault() : new MemorySecretVault();
  return vault;
}
function githubClientId(): string {
  return pickGithubClientId(Capacitor.isNativePlatform(), (globalThis as { __novelaiTestGithubClientId?: unknown }).__novelaiTestGithubClientId);
}

/** 話の一覧を開く場所 */
export function workHash(root: string): string {
  return `#/work/${encodeURIComponent(root)}`;
}

/** 作品の同期の画面（G）を開く場所 */
export function conflictHash(root: string, path: string): string {
  return `#/conflict/${encodeURIComponent(root)}/${encodeURIComponent(path)}`;
}

/** 作品の同期の画面（G）を開く場所 */
export function syncHash(root: string): string {
  return `#/sync/${encodeURIComponent(root)}`;
}

/** 話を原稿エディターで開く場所。`path` は置き場の根から（`root` の中） */
export function episodeHash(root: string, path: string): string {
  if (!path.startsWith(`${root}/`)) throw new Error(`作品の外の話です: ${path}`);
  return `#/episode/${encodeURIComponent(root)}/${encodeURIComponent(path.slice(root.length + 1))}`;
}

/** 誤字脱字を走らせる画面（見積もり F） */
export function typoHash(root: string, path: string): string {
  return episodeHash(root, path).replace("#/episode/", "#/typo/");
}

export function synopsisHash(root: string, path: string): string {
  return episodeHash(root, path).replace("#/episode/", "#/synopsis/");
}

export function proofreadHash(root: string, path: string): string {
  return episodeHash(root, path).replace("#/episode/", "#/proofread/");
}

/** 覚えていた最後の話。作品の外・隠したフォルダーを指していたら捨てる */
function lastEpisodeInWorks(): LastEpisode | undefined {
  const entry = readLastEpisode(globalThis.localStorage);
  if (!entry) return undefined;
  try {
    return parseRoute(episodeHash(entry.root, entry.path)).kind === "episode" ? entry : undefined;
  } catch {
    return undefined;
  }
}

/** 最近開いた話。作品の外・隠したフォルダーを指すものは捨てる */
function recentEpisodesInWorks(): LastEpisode[] {
  return readRecentEpisodes(globalThis.localStorage).filter((entry) => {
    try {
      return parseRoute(episodeHash(entry.root, entry.path)).kind === "episode";
    } catch {
      return false;
    }
  });
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

  /*
    話の一覧で話を長押し → その話の AI の手（設計書 4.4「話の一覧で話を長押し → その話の誤字脱字・推敲・あらすじ」）。
    作ってあるものだけを並べる（いまは誤字脱字だけ。推敲・あらすじは作ったら足す）
  */
  watchLongPress(root, "[data-episode][data-root]", (item) => {
    const workRoot = item.dataset.root!;
    const episode = item.dataset.episode!;
    void chooseFrom([
      { id: "typo", label: "誤字脱字" },
      { id: "proofread", label: "推敲" },
      { id: "synopsis", label: "あらすじ" },
    ]).then((picked) => {
      if (picked === "synopsis") location.hash = synopsisHash(workRoot, episode);
      if (picked === "typo") location.hash = typoHash(workRoot, episode);
      if (picked === "proofread") location.hash = proofreadHash(workRoot, episode);
    });
  });

  /*
    作品の一覧で作品を長押し → 題を変える・登録から外す（設計書 4.4.1。作者の答え 2026-11-18）。
    シリーズ・作品の設定はまだ作っていない（作ってあるものだけ並べる）
  */
  watchLongPress(root, ".work-card[data-work]", (item) => {
    const workRoot = item.dataset.work!;
    void chooseFrom([
      { id: "rename", label: "題を変える" },
      { id: "remove", label: "登録から外す" },
    ]).then(async (picked) => {
      if (picked === "rename") {
        const current = await readWorkLayout(store, workRoot).then((layout) => layout.title).catch(() => undefined);
        if (current === undefined) return toast("作品の設定を読めないので、題を変えられません");
        const title = await askText("作品の題", { initial: current, okLabel: "変える", validate: (value) => (value.trim() ? undefined : "題を入れてください") });
        if (title === undefined) return;
        const outcome = await renameWork(store, workRoot, title);
        if (outcome.kind === "failed") return toast(outcome.message);
        if (outcome.kind === "renamed") toast(["題を変えました", ...outcome.notes].join("。"));
        render();
      }
      if (picked === "remove") {
        const backend = new CapacitorGitFsBackend();
        const check = await checkRemovable(store, createGitFs(backend), workRoot);
        if (!check.ok) return tell(check.reason);
        const title = await readWorkLayout(store, workRoot).then((layout) => layout.title).catch(() => workRoot);
        // 作者のデータを消すので、確かめの窓に残す（設計書 4.6）
        if (!(await askChoice(`「${title}」をこの端末から外します。端末の中のフォルダーは消え、元に戻せません。GitHub の置き場は消しません（取り寄せ直せます）`, "外す", "やめる"))) return;
        await removeWorkFolder(backend, workRoot);
        writeProposals(globalThis.localStorage, readProposals(globalThis.localStorage).filter((proposal) => proposal.root !== workRoot));
        toast("外しました");
        render();
      }
    });
  });

  root.addEventListener("click", (event) => {
    const target = (event.target as HTMLElement).closest<HTMLElement>("[data-screen],[data-planned],[data-tab],[data-back],[data-work],[data-episode],[data-sync],[data-conflict]");
    if (!target) return;
    if (target.dataset.episode && target.dataset.root) {
      location.hash = episodeHash(target.dataset.root, target.dataset.episode);
      return;
    }
    if (target.dataset.work) {
      location.hash = workHash(target.dataset.work);
      return;
    }
    if (target.dataset.conflict && target.dataset.root) {
      location.hash = conflictHash(target.dataset.root, target.dataset.conflict);
      return;
    }
    if (target.dataset.sync) {
      location.hash = syncHash(target.dataset.sync);
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
  /** 原稿エディターで名前が出る行へ飛ぶとき、開いた先でカーソルを置く所 */
  let pendingCaret: { path: string; offset: number } | undefined;
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
      route.kind === "tab" ? route.tab.id : route.kind === "typo" ? "proposals" : route.kind === "synopsis" || route.kind === "work" || route.kind === "sync" || route.kind === "conflict" || route.kind === "episode" || route.kind === "import" ? "works" : route.kind === "all" || route.kind === "github" || route.kind === "display" || route.kind === "licenses" || route.kind === "ai" || route.kind === "drafts" ? "other" : undefined;
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
          route.tab.id === "works"
            ? `<div id="workListSlot" aria-busy="true"></div>`
            : route.tab.id === "write"
              ? renderWriteLead(lastEpisodeInWorks(), recentEpisodesInWorks())
              : route.tab.id === "proposals"
                ? `<div id="proposalsRoot">${renderTypoEntry(lastEpisodeInWorks())}<div id="proposalSlot">${renderProposals(readProposals(globalThis.localStorage))}</div></div>`
                : undefined
        );
        if (route.tab.id === "proposals") wireProposals(screen, store, toast);
        if (route.tab.id === "works") {
          mountWorkList(screen.querySelector<HTMLElement>("#workListSlot")!, store, scanOptions, stillHere);
          // 右下の［＋］：取り寄せる／新しく作る（設計書 4.4.3）
          const add = document.createElement("button");
          add.className = "fab";
          add.id = "addWork";
          add.setAttribute("aria-label", "作品を足す");
          add.textContent = "＋";
          add.addEventListener("click", () => {
            void chooseFrom([
              { id: "import", label: "GitHub から取り寄せる" },
              { id: "new", label: "新しく作る" },
            ]).then((choice) => {
              if (choice === "import") location.hash = "#/import";
              else if (choice === "new") void startNewWork(store, toast);
            });
          });
          screen.appendChild(add);
        }
        return;
      case "work":
        lastTabHash = "#/works";
        mountEpisodeList(screen, store, route.root, scanOptions, stillHere);
        return;
      case "conflict":
        // ［←］は同期の画面へ
        lastTabHash = syncHash(route.root);
        mountConflictScreen(screen, store, route.root, route.path, stillHere);
        return;
      case "sync":
        // ［←］は話の一覧へ
        lastTabHash = workHash(route.root);
        mountSyncScreen(screen, store, route.root, stillHere);
        return;
      case "episode":
        // ［←］は話の一覧へ（話の一覧の［←］は作品一覧へ）
        lastTabHash = workHash(route.root);
        rememberLastEpisode(globalThis.localStorage, { root: route.root, path: route.path });
        ensureTermColorStyle();
        {
          // 名前が出る行へ飛んで来たときは、その字にカーソルを置く（1回だけ使う）
          const caret = pendingCaret?.path === route.path ? pendingCaret.offset : undefined;
          pendingCaret = undefined;
          const episodeRoot = route.root;
          leaveGuard = mountEpisodeScreen(screen, store, route.path, {
            toast,
            stillHere,
            workRoot: episodeRoot,
            openEpisodeAt: (target, offset) => {
              pendingCaret = { path: target, offset };
              location.hash = episodeHash(episodeRoot, target);
            },
            ...(caret !== undefined ? { initialCaret: caret } : {}),
            ...(touchedRecorder(store) ? { beforeWrite: touchedRecorder(store)! } : {}),
            // ［…］→ AI（離れるときに書きかけは保存される）
            runAi: (kind) => {
              location.hash = kind === "typo" ? typoHash(episodeRoot, route.path) : kind === "proofread" ? proofreadHash(episodeRoot, route.path) : synopsisHash(episodeRoot, route.path);
            },
          });
        }
        fillEpisodeSide(screen, store, route.root, route.path, scanOptions, stillHere);
        return;
      case "all":
        mountAllActions(screen);
        return;
      case "typo": {
        lastTabHash = "#/proposals";
        const stop = mountTypoRun(screen, {
          check: route.check,
          // 画面の試験だけ、iOS の「裏に回ったら止める」を確かめられるようにする（端末では使わない）
          ...(!Capacitor.isNativePlatform() && (globalThis as { __novelaiTestPauseWhenHidden?: boolean }).__novelaiTestPauseWhenHidden ? { pauseWhenHidden: true } : {}),
          store,
          root: route.root,
          path: route.path,
          settings: DeviceSettings.load(capacitorPreferencesBackend).then(({ settings }) => settings),
          vault: secretVault(),
          toast,
          stillHere,
        });
        leaveGuard = { isDirty: () => false, destroy: stop };
        return;
      }
      case "synopsis": {
        lastTabHash = "#/works";
        const stop = mountSynopsisRun(screen, {
          store,
          root: route.root,
          path: route.path,
          settings: DeviceSettings.load(capacitorPreferencesBackend).then(({ settings }) => settings),
          vault: secretVault(),
          toast,
          stillHere,
        });
        leaveGuard = { isDirty: () => false, destroy: stop };
        return;
      }
      case "tategaki":
        leaveGuard = mountTategaki(screen, store);
        return;
      case "drafts":
        lastTabHash = "#/other";
        mountOrphanDrafts(screen, store, stillHere, toast);
        return;
      case "ai":
        lastTabHash = "#/other";
        mountAiScreen(screen, stillHere, toast);
        return;
      case "display":
        lastTabHash = "#/other";
        mountDisplayScreen(screen, stillHere);
        return;
      case "licenses":
        lastTabHash = "#/other";
        screen.innerHTML = `${renderAppBar("ライセンス", { back: true })}<div id="licenseSlot"></div>`;
        void fetch(MINCHO_FONT.licenseFile)
          .then((response) => (response.ok ? response.text() : undefined))
          .catch(() => undefined)
          .then((text) => {
            if (stillHere()) screen.querySelector<HTMLElement>("#licenseSlot")!.innerHTML = renderLicenses(text);
          });
        return;
      case "import":
        lastTabHash = "#/works";
        mountImportScreen(screen, store, stillHere);
        return;
      case "github": {
        const github = mountGithubScreen(screen, {
          vault: secretVault(),
          post: nativePostForm,
          clientId: githubClientId(),
          fetchUser: fetchGithubLogin,
          storage: globalThis.localStorage,
          stillHere,
        });
        leaveGuard = { isDirty: () => false, destroy: () => github.destroy() };
        return;
      }
      case "check":
        screen.innerHTML = `${renderAppBar("動作確認ページ", { back: true })}<div id="checkRoot"></div>`;
        mountCheckPage(screen.querySelector<HTMLElement>("#checkRoot")!);
        return;
    }
  };
  window.addEventListener("hashchange", render);
  render();
  // 取り寄せてある明朝を使う（照らして合うときだけ。引継ぎ書 68章）
  void loadInstalledFont();

  // 自動の取得（設計書 6章。引継ぎ書 66章）：開いたとき・前に出たとき。原稿を開いていないときだけ、早送りだけ
  const autoFetch = createAutoFetch({
    listRepos: async () => {
      if (!(store instanceof CapacitorFileStore)) return [];
      const backend = new CapacitorGitFsBackend();
      const repos: string[] = [];
      for (const name of await backend.readdir("/").catch(() => [] as string[])) {
        if (!name.startsWith(".") && (await backend.stat(`/${name}/.git`))) repos.push(name);
      }
      return repos;
    },
    token: async () => (store instanceof CapacitorFileStore ? secretVault().get(GITHUB_TOKEN_SECRET) : undefined),
    fetchOne: (root, token) => fetchWork({ fs: createGitFs(new CapacitorGitFsBackend()), root, token, store, fastForwardOnly: true }),
    canRun: () => {
      const kind = parseRoute(location.hash).kind;
      // 同期の画面（G）も外す（［取ってくる］［送る］と同じ作品の git を重ねて触らない）
      return !leaveGuard && kind !== "episode" && kind !== "conflict" && kind !== "tategaki" && kind !== "import" && kind !== "sync";
    },
  });
  const autoFetchNow = () =>
    void autoFetch.run().then((result) => {
      // 取り込んだら、一覧の画面だけ描き直す（印と最後に書いた日を新しくする）
      const kind = parseRoute(location.hash).kind;
      if (result && result.fetched.length > 0 && !leaveGuard && (kind === "tab" || kind === "work")) render();
    });
  autoFetchNow();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") autoFetchNow();
  });
}

/* ---------- 作品一覧（A）と話の一覧（B） ---------- */

/**
 * 作品の同期の状態（送っていない話。設計書 6章）。端末の置き場のときだけ（git の置き場も同じ `works` を指す）。
 * 読めなければ出さない（同期の状態が分からないだけで、一覧は出す）
 */
async function syncStateOf(store: FileStore, root: string): Promise<WorkSyncState | undefined> {
  if (!(store instanceof CapacitorFileStore)) return undefined;
  try {
    return await readWorkSync(createGitFs(new CapacitorGitFsBackend()), root);
  } catch {
    return undefined;
  }
}

function flagHtml(state: WorkSyncState | undefined, extraClass = ""): string {
  const flag = syncFlag(state);
  return flag ? `<span class="flag ${flag.tone}${extraClass}" data-sync-flag>${escapeHtml(flag.text)}</span>` : "";
}

/** 話の一覧の頭の印。押すと同期の画面（G） */
function flagButtonHtml(state: WorkSyncState | undefined, root: string): string {
  const flag = syncFlag(state);
  return flag
    ? `<button class="flag ${flag.tone} work-warn sync-open" data-sync-flag data-sync="${escapeHtml(root)}">${escapeHtml(flag.text)}</button>`
    : "";
}

/** アプリが書いた話を控える係（端末の置き場のときだけ。1つを使い回して、控えの書き込みを並べる） */
let recorder: ((storePath: string) => Promise<void>) | undefined;
function touchedRecorder(store: FileStore): ((storePath: string) => Promise<void>) | undefined {
  if (!(store instanceof CapacitorFileStore)) return undefined;
  recorder ??= createTouchedRecorder(createGitFs(new CapacitorGitFsBackend()));
  return recorder;
}

/** 取ってきた版と競合している話（端末の置き場のときだけ） */
async function conflictsOf(store: FileStore, root: string): Promise<SyncConflictRow[]> {
  if (!(store instanceof CapacitorFileStore)) return [];
  return listConflicts(createGitFs(new CapacitorGitFsBackend()), root);
}

/** 選ぶ画面から同期の画面へ持ち帰る1行（作品ごと。読んだら消す） */
const syncNotices = new Map<string, string>();
function takeSyncNotice(root: string): string | undefined {
  const notice = syncNotices.get(root);
  syncNotices.delete(root);
  return notice;
}

/**
 * 競合した話を選ぶ画面（引継ぎ書 60章）。［こちら｜あちら］で見る文を替え、下のボタンで選ぶ。
 * ［あちらにする］は確かめてから。選んだら同期の画面へ戻る（全部選び終えていれば取り込んで、その結果を出す）
 */
function mountConflictScreen(screen: HTMLElement, store: FileStore, root: string, path: string, stillHere: () => boolean): void {
  const name = path.slice(path.lastIndexOf("/") + 1).replace(/\.txt$/i, "");
  screen.innerHTML = `${renderAppBar(name, { back: true, sub: "競合" })}<div id="conflictSlot" aria-busy="true"></div>`;
  const slot = screen.querySelector<HTMLElement>("#conflictSlot")!;
  if (!(store instanceof CapacitorFileStore)) return;
  const fs = createGitFs(new CapacitorGitFsBackend());
  let material: ConflictMaterial | undefined;
  let view: ConflictView = "ours";
  let busy = false;
  const back = (notice?: string) => {
    if (notice) syncNotices.set(root, notice);
    location.replace(syncHash(root));
  };
  const show = () => {
    if (!stillHere() || !material) return;
    slot.innerHTML = renderConflictView(material, view);
    slot.removeAttribute("aria-busy");
  };
  slot.addEventListener("click", (event) => {
    const target = (event.target as HTMLElement).closest<HTMLElement>("[data-cf-view],[data-cf-choice]");
    if (!target || !material || busy) return;
    if (target.dataset.cfView) {
      view = target.dataset.cfView === "theirs" ? "theirs" : "ours";
      return show();
    }
    const choice = target.dataset.cfChoice as ConflictChoice;
    const chosen = material;
    void (async () => {
      if (choice === "theirs") {
        const question = theirsQuestion(chosen);
        if (!(await askChoice(question.message, question.yes, "やめる"))) return;
      }
      busy = true;
      slot.setAttribute("aria-busy", "true");
      try {
        const { applied, outcome } = await chooseConflict({ fs, root, store, material: chosen, choice });
        if (!applied.ok) {
          await tell(applyFailureText(applied));
          return back();
        }
        back(outcome ? outcomeText(outcome) : undefined);
      } catch {
        await tell("書けませんでした。原稿は変えていません");
        back();
      } finally {
        busy = false;
      }
    })();
  });
  void readConflictMaterial({ fs, root, store, path }).then(
    (read) => {
      if (!stillHere()) return;
      if (!read) return back();
      material = read;
      show();
    },
    () => back()
  );
}

/** ［取ってくる］［送る］が押せるか（サインイン・作品の GitHub の置き場） */
async function syncAccessOf(store: FileStore, root: string): Promise<SyncAccess> {
  if (!(store instanceof CapacitorFileStore)) return "noRemote";
  try {
    const target = await readRepoTarget(createGitFs(new CapacitorGitFsBackend()), workRepo(root).dir);
    if (!target) return "noRemote";
    return (await secretVault().get(GITHUB_TOKEN_SECRET)) ? "ready" : "signedOut";
  } catch {
    return "noRemote";
  }
}

/**
 * 同期の画面（G）。数え終えるまでは空の枠。［取ってくる］［送る］を押すと、済むまで両方を押せなくし、
 * 結果を1行出して、送っていない話を数え直す（引継ぎ書 59章）
 */
function mountSyncScreen(screen: HTMLElement, store: FileStore, root: string, stillHere: () => boolean): void {
  screen.innerHTML = `${renderAppBar("同期", { back: true, sub: root })}<div id="syncSlot" aria-busy="true"></div>`;
  const slot = screen.querySelector<HTMLElement>("#syncSlot")!;
  let state: WorkSyncState | undefined;
  let running = false;
  const paint = async (result?: string) => {
    const [next, access, conflicts] = await Promise.all([syncStateOf(store, root), syncAccessOf(store, root), conflictsOf(store, root)]);
    if (!stillHere()) return;
    state = next;
    slot.innerHTML = renderSyncScreen(root, state, access, conflicts);
    // 競合を選び終えて取り込んだ結果は、戻ってきたこの画面に出す
    const shown = result ?? takeSyncNotice(root);
    if (shown) slot.querySelector<HTMLElement>("#syncResult")!.textContent = shown;
    slot.removeAttribute("aria-busy");
  };
  const run = async (kind: "fetch" | "send"): Promise<string> => {
    const token = await secretVault().get(GITHUB_TOKEN_SECRET);
    if (!token) return outcomeText({ kind: "failed", reason: "sign_in_again" });
    const fs = createGitFs(new CapacitorGitFsBackend());
    if (kind === "fetch") return outcomeText(await fetchWork({ fs, root, token, store }));
    let user = readGithubUser(globalThis.localStorage);
    if (!user) {
      user = await fetchGithubLogin(token);
      writeGithubUser(globalThis.localStorage, user);
    }
    if (!user) return outcomeText({ kind: "failed", reason: "offline" });
    const message = pushMessage((state?.unsent ?? []).map((file) => file.path));
    return outcomeText(await sendWork({ fs, root, token, author: githubIdentity(user.login, user.id), message }));
  };
  slot.addEventListener("click", (event) => {
    const target = (event.target as HTMLElement).closest<HTMLElement>("[data-sync-run]");
    if (!target || running) return;
    running = true;
    slot.setAttribute("aria-busy", "true");
    for (const button of slot.querySelectorAll<HTMLButtonElement>("[data-sync-run]")) button.disabled = true;
    slot.querySelector<HTMLElement>("#syncResult")!.textContent = "";
    const kind = target.dataset.syncRun === "fetch" ? "fetch" : "send";
    void run(kind)
      .catch(() => outcomeText({ kind: "failed", reason: "unknown" }))
      .then((result) => {
        running = false;
        return paint(result);
      });
  });
  void paint();
}

/**
 * 一覧を描いたあとで、札ごとに同期の状態を足す（数えるのに作品のファイルを全部見るので、描くのを待たせない）。
 * 送っていない話があれば、「最後に書いた日」はその話を書いた日にする（2026-11-16 作者の答え。引継ぎ書 48章）
 */
async function fillWorkSync(slot: HTMLElement, store: FileStore, stillHere: () => boolean): Promise<void> {
  for (const card of [...slot.querySelectorAll<HTMLElement>(".work-card[data-work]")]) {
    const state = await syncStateOf(store, card.dataset.work!);
    if (!stillHere()) return;
    card.insertAdjacentHTML("beforeend", flagHtml(state));
    const latest = latestUnsentTime(state);
    if (latest === undefined) continue;
    const label = `最後に書いた日：${dayLabel(new Date(latest), new Date())}`;
    const meta = card.querySelector<HTMLElement>(".work-meta");
    const dateSpan = [...(meta?.children ?? [])].find((el) => el.textContent?.startsWith("最後に書いた日："));
    if (dateSpan) dateSpan.textContent = label;
    else meta?.insertAdjacentHTML("beforeend", `<span>${escapeHtml(label)}</span>`);
  }
}

/** 作品を読み終えたら一覧を描く（読む間は空の枠のまま） */
function mountWorkList(slot: HTMLElement, store: FileStore, options: ScanOptions, stillHere: () => boolean): void {
  const show = (html: string) => {
    if (!stillHere()) return false;
    slot.innerHTML = html;
    slot.removeAttribute("aria-busy");
    return true;
  };
  listWorks(store, options).then(
    (items) => {
      if (show(renderWorkList(items, new Date()))) void fillWorkSync(slot, store, stillHere);
    },
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
      void syncStateOf(store, root).then((state) => {
        const flag = flagButtonHtml(state, root);
        if (flag && stillHere()) slot.insertAdjacentHTML("afterbegin", flag);
      });
    },
    (error) => show(renderWorkError(error instanceof Error ? error.message : String(error)))
  );
}

/**
 * 原稿エディターの左の話の一覧（中・広い段。設計書 4.3）。狭い段では CSS で隠れるが、中身は同じに入れておく
 * （回転で段が変わっても、作り直さずに出せる）。開いている話に印。押すと、保存を済ませてその話へ移る
 */
function fillEpisodeSide(screen: HTMLElement, store: FileStore, root: string, path: string, options: ScanOptions, stillHere: () => boolean): void {
  const side = screen.querySelector<HTMLElement>("#msSide");
  if (!side) return;
  scanWorkFolder(store, root, options).then(
    (work) => {
      if (!stillHere()) return;
      side.innerHTML = `<h2 class="ms-side-title">${escapeHtml(work.title)}</h2>${renderEpisodeList(work)}`;
      for (const row of side.querySelectorAll<HTMLElement>("[data-episode]")) {
        if (row.dataset.episode === path) row.setAttribute("aria-current", "page");
      }
    },
    () => undefined
  );
}

/**
 * GitHub から取り寄せる（引継ぎ書 65章）。作者のリポジトリを並べ、押すと浅く取り寄せて、その作品の話の一覧を開く。
 * 取り寄せているあいだは、ほかの行を押せない
 */
function mountImportScreen(screen: HTMLElement, store: FileStore, stillHere: () => boolean): void {
  screen.innerHTML = `${renderAppBar("GitHub から取り寄せる", { back: true })}<div id="importSlot"></div>`;
  const slot = screen.querySelector<HTMLElement>("#importSlot")!;
  const backend = new CapacitorGitFsBackend();
  let repos: GithubRepo[] = [];
  let running = false;
  const show = (view: ImportView) => {
    if (stillHere()) slot.innerHTML = renderImportView(view);
  };
  const existing = async (): Promise<Set<string>> => new Set(await backend.readdir("/").catch(() => [] as string[]));
  const load = async () => {
    show({ kind: "busy" });
    if (!(store instanceof CapacitorFileStore)) return show({ kind: "failed", reason: "unknown" });
    const token = await secretVault().get(GITHUB_TOKEN_SECRET);
    if (!token) return show({ kind: "signedOut" });
    const result = await listGithubRepos(token);
    if (result.kind === "failed") return show({ kind: "failed", reason: result.reason });
    repos = result.repos;
    show({ kind: "repos", repos, existing: await existing() });
  };
  slot.addEventListener("click", (event) => {
    const target = (event.target as HTMLElement).closest<HTMLElement>("[data-import],[data-import-retry]");
    if (!target || running) return;
    if (target.dataset.importRetry !== undefined) return void load();
    const repo = repos.find((candidate) => `${candidate.owner}/${candidate.name}` === target.dataset.import);
    if (!repo) return;
    running = true;
    target.setAttribute("aria-busy", "true");
    for (const button of slot.querySelectorAll<HTMLButtonElement>("[data-import]")) button.disabled = true;
    const line = slot.querySelector<HTMLElement>("#importResult");
    if (line) line.textContent = "";
    void (async () => {
      const token = await secretVault().get(GITHUB_TOKEN_SECRET);
      // 進み具合は押した行の右に（大きい作品は時間がかかる。止まっていないと分かるように）
      const progress = target.querySelector<HTMLElement>(".chars");
      let shownAt = 0;
      const onProgress = (phase: string, loaded: number, total?: number) => {
        const now = Date.now();
        if (!progress || now - shownAt < 200) return;
        shownAt = now;
        progress.textContent = progressLabel(phase, loaded, total);
      };
      if (progress) progress.textContent = progressLabel("", 0);
      const result = token ? await importWork({ backend, repo, token, onProgress }) : ({ kind: "failed", reason: "sign_in_again" } as const);
      running = false;
      if (!stillHere()) return;
      if (result.kind === "imported") {
        location.hash = workHash(result.root);
        return;
      }
      show({ kind: "repos", repos, existing: await existing() });
      const after = slot.querySelector<HTMLElement>("#importResult");
      if (after) after.textContent = importResultText(result) ?? "";
    })();
  });
  void load();
}

/* ---------- 新しく作る（引継ぎ書 75章） ---------- */

/**
 * 題 → リポジトリの名前 → 確かめ（「GitHub に非公開のリポジトリ〈名前〉を作ります」）→ 作って取り寄せ、形を置いて話の一覧を開く。
 * サインインしていなければ［GitHub と同期］へ
 */
async function startNewWork(store: FileStore, toast: (text: string) => void): Promise<void> {
  if (!(store instanceof CapacitorFileStore)) return toast(NOT_BUILT_MESSAGE);
  const token = await secretVault().get(GITHUB_TOKEN_SECRET);
  if (!token) {
    toast("先に GitHub にサインインしてください");
    location.hash = "#/github";
    return;
  }
  const title = await askText("作品の題", { okLabel: "次へ", validate: (value) => (value.trim() ? undefined : "題を入れてください") });
  if (title === undefined) return;
  const repoName = await askText("GitHub のリポジトリの名前（英数字）", { okLabel: "次へ", validate: (value) => repoNameProblem(value) });
  if (repoName === undefined) return;
  const go = await askChoice(`GitHub に非公開のリポジトリ「${repoName.trim()}」を作ります`, "作る", "やめる");
  if (!go) return;
  toast("作っています…");
  const result = await createNewWork({ backend: new CapacitorGitFsBackend(), store, token, title, repoName });
  if (result.kind === "created") {
    location.hash = workHash(result.root);
    return;
  }
  await tell(newWorkResultText(result));
}

/* ---------- 設定 → AI（クラウドの AI の鍵。引継ぎ書 71章） ---------- */

function mountAiScreen(screen: HTMLElement, stillHere: () => boolean, toast: (text: string) => void): void {
  screen.innerHTML = `${renderAppBar("AI", { back: true })}${renderAiScreen([])}<div id="aiAssign"></div>`;
  const slot = screen.querySelector<HTMLElement>("#aiKeys")!;
  const assignSlot = screen.querySelector<HTMLElement>("#aiAssign")!;
  const results = new Map<CloudProviderId, { text: string; ok: boolean }>();
  // 機能ごとの割り当て（引継ぎ書 74章）。端末の設定に置く（同期しない）
  const loaded = DeviceSettings.load(capacitorPreferencesBackend).then(({ settings }) => settings);
  const models = new Map<CloudProviderId, string[]>();
  const registeredSet = async (): Promise<Set<CloudProviderId>> => {
    const usable = new Set<CloudProviderId>();
    for (const provider of CLOUD_PROVIDERS) if ((await secretVault().get(provider.secret)) !== undefined) usable.add(provider.id);
    return usable;
  };
  const paint = async () => {
    const rows: KeyRow[] = [];
    const usable = await registeredSet();
    for (const provider of CLOUD_PROVIDERS) {
      const result = results.get(provider.id);
      rows.push({ provider, registered: usable.has(provider.id), ...(result ? { result } : {}) });
    }
    const settings = await loaded;
    const { assignments, defaultChoice } = readAiChoices(settings);
    const defaultText =
      defaultChoice.provider && defaultChoice.model ? describeChoice({ provider: defaultChoice.provider, model: defaultChoice.model }) : undefined;
    if (!stillHere()) return;
    slot.innerHTML = renderKeyRows(rows);
    assignSlot.innerHTML = renderAssignmentSections(defaultText, featureRows(assignments, defaultChoice, usable));
  };
  /** 鍵のある AI を選び、そのモデルを選ぶ。`keepDefault` なら頭に「既定のまま」（"default" を返す） */
  const chooseAi = async (keepDefault: boolean): Promise<{ provider: CloudProviderId; model: string } | "default" | undefined> => {
    const usable = await registeredSet();
    if (usable.size === 0) {
      toast("先に APIキーを登録してください");
      return undefined;
    }
    const picked = await chooseFrom([
      ...(keepDefault ? [{ id: "default", label: "既定のまま" }] : []),
      ...CLOUD_PROVIDERS.filter((provider) => usable.has(provider.id)).map((provider) => ({ id: provider.id, label: provider.displayName })),
    ]);
    if (!picked || picked === "default") return picked as "default" | undefined;
    const provider = CLOUD_PROVIDERS.find((candidate) => candidate.id === picked)!;
    let list = models.get(provider.id);
    if (!list) {
      const key = await secretVault().get(provider.secret);
      const check = key ? await checkApiKey(provider.id, key) : ({ kind: "bad_key" } as const);
      if (check.kind !== "ok" || check.models.length === 0) {
        toast(check.kind === "ok" ? "選べるモデルがありません" : keyCheckText(check));
        return undefined;
      }
      list = check.models;
      models.set(provider.id, list);
    }
    const model = await chooseFrom(list.map((name) => ({ id: name, label: name })));
    return model ? { provider: provider.id, model } : undefined;
  };
  assignSlot.addEventListener("click", (event) => {
    const target = (event.target as HTMLElement).closest<HTMLElement>("[data-ai-default],[data-ai-feature]");
    if (!target) return;
    void (async () => {
      const settings = await loaded;
      if (target.dataset.aiDefault !== undefined) {
        const choice = await chooseAi(false);
        if (!choice || choice === "default") return;
        await saveDefaultChoice(settings, choice);
        toast(PAID_ASSIGN_NOTICE);
      } else {
        const feature = target.dataset.aiFeature as AssignableFeature;
        const choice = await chooseAi(true);
        if (!choice) return;
        const { assignments } = readAiChoices(settings);
        await saveFeatureChoice(settings, assignments, feature, choice === "default" ? undefined : choice);
        if (choice !== "default") toast(PAID_ASSIGN_NOTICE);
      }
      await paint();
    })();
  });
  slot.addEventListener("click", (event) => {
    const target = (event.target as HTMLElement).closest<HTMLElement>("[data-ai-set],[data-ai-check],[data-ai-remove]");
    if (!target) return;
    const id = (target.dataset.aiSet ?? target.dataset.aiCheck ?? target.dataset.aiRemove) as CloudProviderId;
    const provider = CLOUD_PROVIDERS.find((candidate) => candidate.id === id);
    if (!provider) return;
    void (async () => {
      if (target.dataset.aiSet) {
        const prompt = keyPrompt(provider);
        const value = await askText(prompt.message, {
          password: true,
          placeholder: prompt.placeholder,
          note: prompt.note,
          okLabel: "登録",
          validate: (raw) => validateApiKeyFormat(raw),
        });
        if (value === undefined) return;
        await saveApiKey(secretVault(), provider, value);
        results.delete(provider.id);
      } else if (target.dataset.aiCheck) {
        const key = await secretVault().get(provider.secret);
        if (!key) return;
        target.setAttribute("aria-busy", "true");
        const check = await checkApiKey(provider.id, key);
        results.set(provider.id, { text: keyCheckText(check), ok: check.kind === "ok" });
      } else {
        if (!(await askChoice(removeQuestion(provider), "消す", "やめる"))) return;
        await secretVault().remove(provider.secret);
        results.delete(provider.id);
      }
      await paint();
    })();
  });
  void paint();
}

/* ---------- 表示（書体の取り寄せ。引継ぎ書 68章） ---------- */

const fontShelf = new DeviceFontShelf();
let installedFace: FontFace | undefined;

async function loadInstalledFont(): Promise<void> {
  if (installedFace) return;
  const bytes = await readVerifiedFont(fontShelf, MINCHO_FONT.file, MINCHO_FONT);
  if (!bytes) return;
  try {
    installedFace = await useFont(MINCHO_FONT.family, bytes);
  } catch {
    /* 読めない書体なら、端末の書体のまま */
  }
}

/** 表示の画面。明朝の大きさを示し、押したときだけ取り寄せる。照らして合ったものだけ書いて使う */
function mountDisplayScreen(screen: HTMLElement, stillHere: () => boolean): void {
  screen.innerHTML = `${renderAppBar("表示", { back: true })}<div id="lookSlot">${renderLookSection(readLook(globalThis.localStorage))}</div><div id="bodyFontSlot">${renderBodyFontSection(readBodyFont(globalThis.localStorage))}</div><div id="lineSlot">${renderLineSection(readCompositionLine(), readLeftLineTermColors())}</div>${renderDisplayScreen({ kind: "checking" })}`;
  const slot = screen.querySelector<HTMLElement>("#fontSlot")!;
  const lineSlot = screen.querySelector<HTMLElement>("#lineSlot")!;
  const bodyFontSlot = screen.querySelector<HTMLElement>("#bodyFontSlot")!;
  bodyFontSlot.addEventListener("click", (event) => {
    const chosen = (event.target as HTMLElement).closest<HTMLElement>("[data-body-font]")?.dataset.bodyFont;
    if (!chosen) return;
    const font = parseBodyFont(chosen);
    writeBodyFont(globalThis.localStorage, font);
    applyBodyFont(document.documentElement, font);
    bodyFontSlot.innerHTML = renderBodyFontSection(font);
  });
  const lookSlot = screen.querySelector<HTMLElement>("#lookSlot")!;
  lookSlot.addEventListener("click", (event) => {
    const choice = (event.target as HTMLElement).closest<HTMLElement>("[data-look-choice]");
    if (!choice) return;
    const look = parseLook(choice.dataset.lookChoice);
    writeLook(globalThis.localStorage, look);
    applyLook(document.documentElement, look);
    lookSlot.innerHTML = renderLookSection(look);
  });
  lineSlot.addEventListener("click", (event) => {
    const colors = (event.target as HTMLElement).closest<HTMLElement>("[data-term-colors]");
    if (colors) writeLeftLineTermColors(colors.dataset.termColors === "on");
    const target = (event.target as HTMLElement).closest<HTMLElement>("[data-line]");
    if (target) writeCompositionLine(target.dataset.line === "right" ? "right" : "left");
    if (!colors && !target) return;
    lineSlot.innerHTML = renderLineSection(readCompositionLine(), readLeftLineTermColors());
  });
  let abort: AbortController | undefined;
  const show = (view: FontView) => {
    if (stillHere()) slot.innerHTML = renderFontRow(view);
  };
  slot.addEventListener("click", (event) => {
    const target = (event.target as HTMLElement).closest<HTMLElement>("[data-font]");
    if (!target) return;
    switch (target.dataset.font) {
      case "get": {
        if (abort) return;
        abort = new AbortController();
        show({ kind: "downloading", percent: 0 });
        let shownAt = 0;
        void downloadFont(MINCHO_FONT, {
          signal: abort.signal,
          onProgress: (loaded, total) => {
            const now = Date.now();
            if (now - shownAt < 200) return;
            shownAt = now;
            const progress = slot.querySelector<HTMLElement>(".font-progress");
            if (progress) progress.textContent = `${Math.floor((loaded / total) * 100)}%`;
          },
        }).then(async (result) => {
          abort = undefined;
          if (result.kind === "stopped") return show({ kind: "absent" });
          if (result.kind !== "done") return show({ kind: "absent", failure: FONT_FAILURE[result.kind] });
          try {
            await fontShelf.write(MINCHO_FONT.file, result.bytes);
            installedFace = await useFont(MINCHO_FONT.family, result.bytes);
            show({ kind: "installed" });
          } catch {
            show({ kind: "absent", failure: FONT_FAILURE.failed });
          }
        });
        return;
      }
      case "stop":
        abort?.abort();
        return;
      case "remove":
        void fontShelf.remove(MINCHO_FONT.file).catch(() => undefined).then(() => {
          if (installedFace) document.fonts.delete(installedFace);
          installedFace = undefined;
          show({ kind: "absent" });
        });
        return;
    }
  });
  void (async () => {
    if (installedFace) return show({ kind: "installed" });
    await loadInstalledFont();
    show(installedFace ? { kind: "installed" } : { kind: "absent" });
  })();
}

/* ---------- 提案（D）：誤字脱字の指摘を採る・見送る（段2） ---------- */

function wireProposals(screen: HTMLElement, store: FileStore, toast: (text: string) => void): void {
  // 聞き手は、この描画で作った入れ物に付ける（screen に付けると、タブを開くたびに重なり、［採る］が2回当たる）
  const host = screen.querySelector<HTMLElement>("#proposalsRoot");
  if (!host) return;
  const slot = host.querySelector<HTMLElement>("#proposalSlot");
  const repaint = (list: TypoProposal[]) => {
    writeProposals(globalThis.localStorage, list);
    if (slot) slot.innerHTML = renderProposals(list);
  };
  let busy = false;
  host.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    const entry = target.closest<HTMLElement>("[data-typo-path]");
    if (entry?.dataset.typoPath && entry.dataset.typoRoot) {
      location.hash = typoHash(entry.dataset.typoRoot, entry.dataset.typoPath);
      return;
    }
    const proofread = target.closest<HTMLElement>("[data-proofread-path]");
    if (proofread?.dataset.proofreadPath && proofread.dataset.proofreadRoot) {
      location.hash = proofreadHash(proofread.dataset.proofreadRoot, proofread.dataset.proofreadPath);
      return;
    }
    const dismiss = target.closest<HTMLElement>("[data-dismiss]")?.dataset.dismiss;
    if (dismiss) return repaint(withoutProposal(readProposals(globalThis.localStorage), dismiss));
    const accept = target.closest<HTMLElement>("[data-accept]")?.dataset.accept;
    if (!accept || busy) return;
    const proposal = readProposals(globalThis.localStorage).find((item) => item.id === accept);
    // 修正案の無い指摘（推敲の語尾単調など）は当てない（当てると原文が消える）
    if (!proposal || !proposal.suggestion) return;
    busy = true;
    const recorder = touchedRecorder(store);
    void applyProposal(store, proposal, recorder)
      .then((outcome) => {
        toast(applyOutcomeText(outcome));
        // 当てた・当てられなくなった指摘は外す。書けなかった（外で変わった など）ときは残す
        if (outcome.kind === "applied" || outcome.kind === "stale") repaint(withoutProposal(readProposals(globalThis.localStorage), accept));
      })
      .finally(() => {
        busy = false;
      });
  });
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
    <section class="menu-section trial-items"><h2>試し</h2><div class="menu-items">${TRIAL_ITEMS.map(itemButton).join("")}</div></section>
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

  /** 試しで、iPad と同じく C のカーソルをこちらで描く印（e2e・エミュレーター用） */
  function readDebugOwnCaret(): boolean {
    try {
      return window.localStorage.getItem("novelai.debug.ownCaret") === "on";
    } catch {
      return false;
    }
  }
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
      },
      // iOS は、カーソルをこちらで描く（縦書き・横書きとも。2026-11-17 作者の iPad の写真）。試しでは印を立てて同じ形にする
      { ownCaret: Capacitor.getPlatform() === "ios" || readDebugOwnCaret() }
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
