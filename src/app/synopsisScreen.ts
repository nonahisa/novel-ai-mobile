import { containsConflictMarkers, countChars, decideFeatureAI, paidUsageNotice } from "../shared";
import { describeChoice, readAiChoices } from "../platform/aiAssignment";
import { CLOUD_PROVIDERS, type CloudProviderId } from "../platform/aiKeys";
import type { DeviceSettings } from "../platform/deviceSettings";
import type { FileStore } from "../platform/fileStore";
import { toStorePath } from "../platform/paths";
import type { SecretVault } from "../platform/secretVault";
import { planSynopses, runSynopses, type SynopsisPart } from "../platform/synopsisRun";
import { loadSynopses, saveFailureText, saveSynopses, type LoadedSynopses } from "../platform/synopsisStore";
import { readTextFile } from "../platform/textFile";
import { typoCallerFor } from "../platform/typoCallers";
import type { ModelCall } from "../platform/typoCheck";
import { readWorkLayout, scanWorkFolder } from "../platform/workScan";
import { readWorkTerms } from "../platform/workTerms";
import { escapeHtml, renderAppBar } from "./menuScreen";
import { backgroundWork, whileWorking, type BackgroundWork } from "../platform/backgroundWork";
import { confirmPaidUsage } from "./paidConfirm";
import { episodeName, mountEpisodePicker, pickedEpisodesText, renderTypoEstimate, type PickRow } from "./typoScreen";
import { findSynopsis } from "../shared";
import { chooseAiForRun } from "./aiChoose";
import { noteFailure } from "../platform/failureLog";
import { askChoice, tell } from "./dialog";
import { renameEpisodeWithLedgers, renamedEpisodeFileName } from "../platform/episodeRename";
import { Capacitor } from "@capacitor/core";

/**
 * **各話あらすじを作る画面**（段2。2026-11-18。話の長押し → あらすじ）。
 *
 * 見積もり（話・字数・AI・料金）→ 有料の確認 → 作る → 台帳（`設定/chapter_synopses.json`）へ書く → 作ったあらすじを並べる。
 * 指摘ではないので［提案］へは出さない（本体と同じく台帳へ直に書く。作者が書いたものは触らない）。
 * サブタイトル案は見せるだけ（ファイル名は変えない）。AI は機能ごとの割り当ての「生成」（本体と同じ区分）。
 * **何話かまとめて**（2026-11-21）：誤字脱字・推敲と同じ［話を選ぶ］（1話ずつの印・［すべて］・範囲。2026-11-18 作者の答え）。
 * 話の一覧の並びで1話ずつ作り、**話ごとに台帳へ書く**（途中で止めても作れた話は残る）。前の話のあらすじには、その回で作ったものも渡す。
 * 誤字脱字・推敲とそろえて、見積もりの AI の行でその回だけ AI を替えられ、iOS で裏に回したら1区切りで止める（2026-11-18 作者の答え 案A。引継ぎ書 120章）。
 * **サブタイトル案を押すと、話のファイル名にする**（2026-11-21 作者の答え「パソコンと同じにする」）：「この名前にします」と確かめてから
 * ファイル名を変え、パスで話を指す台帳を付け替える（`platform/episodeRename.ts`）。1話ずつ。まとめて自動では変えない（本体と同じ）
 */

export interface SynopsisRunDeps {
  /**
   * 同期で競合したまま、まだ［こちら］［あちら］［両方残す］を選んでいない話（置き場の中の場所）。設計書 6章「選ぶまで、
   * その話には AI を当てない」。競合の印〈<<<<<<<〉が本文に無くても、選ぶまでは当てない。省けば無い
   */
  undecidedConflicts?: () => Promise<readonly string[]>;
  store: FileStore;
  root: string;
  path: string;
  settings: Promise<DeviceSettings>;
  vault: SecretVault;
  toast: (text: string) => void;
  stillHere: () => boolean;
  /** 裏に回っても続けるための口（試験で差し替える） */
  background?: BackgroundWork;
  /** 裏に回ったら、いまの1回を終えたところで止める（既定は iOS のとき。画面の試験で差し替える） */
  pauseWhenHidden?: boolean;
  /** 書く直前に、その道をアプリが書いた控えへ（`touchedPaths.ts`） */
  beforeWrite?: (path: string) => Promise<void>;
  /** 話の名前を変えたあと（端末の中の記録を新しい名前へ・字数の基準を置き直す） */
  afterRename?: (from: string, to: string) => Promise<void>;
}

/** いまの台帳の、この話のあらすじ（作者が書いたものには印） */
export function renderSynopsisList(
  rows: readonly { label: string; synopsis: string; byAuthor?: boolean; subtitles?: readonly string[]; path?: string }[]
): string {
  if (rows.length === 0) return "";
  const subtitlesOf = (row: (typeof rows)[number]) => {
    if (!row.subtitles || row.subtitles.length === 0) return "";
    // 話の場所が分かるときは、押すとファイル名にする（確かめてから）。分からなければ見せるだけ
    if (!row.path) return `<span class="synopsis-subtitles">${escapeHtml(`サブタイトル案：${row.subtitles.join("／")}`)}</span>`;
    const buttons = row.subtitles
      .map((subtitle) => `<button type="button" class="synopsis-subtitle" data-rename-path="${escapeHtml(row.path!)}" data-rename-subtitle="${escapeHtml(subtitle)}">${escapeHtml(subtitle)}</button>`)
      .join("");
    return `<span class="synopsis-subtitles">サブタイトル案（押すとファイル名にします）${buttons}</span><span class="synopsis-renamed" role="status"></span>`;
  };
  const items = rows
    .map(
      (row) =>
        `<div class="synopsis-row"><dt>${escapeHtml(row.label)}${row.byAuthor ? `<span class="flag">作者</span>` : ""}</dt>` +
        `<dd>${escapeHtml(row.synopsis)}${subtitlesOf(row)}</dd></div>`
    )
    .join("");
  return `<dl class="synopsis-list">${items}</dl>`;
}

/** 1話ぶんの見積もりの元 */
interface EpisodePlan {
  path: string;
  fileName: string;
  parts: SynopsisPart[];
  chars: number;
  conflicted: boolean;
}

export function mountSynopsisRun(screen: HTMLElement, deps: SynopsisRunDeps): () => void {
  screen.innerHTML = `${renderAppBar("あらすじ", { back: true })}<div id="typoSlot" aria-busy="true"></div><div id="synopsisNow"></div>`;
  const slot = screen.querySelector<HTMLElement>("#typoSlot")!;
  const now = screen.querySelector<HTMLElement>("#synopsisNow")!;
  const abort = new AbortController();
  const fail = (message: string) => {
    noteFailure("あらすじ（読み込み）", message);
    if (!deps.stillHere()) return;
    slot.removeAttribute("aria-busy");
    slot.innerHTML = `<p class="flag shu long">${escapeHtml(message)}</p>`;
  };
  void (async () => {
    let loaded: LoadedSynopses;
    let characterNames: string[];
    let settingsDir: string;
    let memoMarkers: Awaited<ReturnType<typeof readWorkLayout>>["memoMarkers"];
    let work: Awaited<ReturnType<typeof scanWorkFolder>>;
    let rows: PickRow[];
    let undecided: Set<string>;
    const settings = await deps.settings;
    const usable = new Set<CloudProviderId>();
    for (const provider of CLOUD_PROVIDERS) if ((await deps.vault.get(provider.secret)) !== undefined) usable.add(provider.id);
    const { assignments, defaultChoice } = readAiChoices(settings);
    // その回だけ替えられる（見積もりの AI の行を押す。設定は変えない）
    let choice = decideFeatureAI("generate", assignments, defaultChoice, (id) => usable.has(id)).choice;
    let provider = choice ? CLOUD_PROVIDERS.find((candidate) => candidate.id === choice!.provider) : undefined;
    try {
      const content = await readTextFile(deps.store, deps.path);
      if (containsConflictMarkers(content.text)) return fail("競合が残っている話には AI を当てません");
      undecided = new Set(await (deps.undecidedConflicts?.() ?? Promise.resolve<readonly string[]>([])).catch((): readonly string[] => []));
      if (undecided.has(deps.path)) return fail("競合が残っている話には AI を当てません");
      const [scanned, layout] = await Promise.all([scanWorkFolder(deps.store, deps.root), readWorkLayout(deps.store, deps.root)]);
      work = scanned;
      if (!work.episodes.some((episode) => toStorePath(episode.filePath) === deps.path)) return fail("この話が作品の話の一覧に見つかりません");
      settingsDir = layout.settings;
      memoMarkers = layout.memoMarkers;
      loaded = await loadSynopses(deps.store, settingsDir);
      characterNames = (await readWorkTerms(deps.store, settingsDir)).entries.filter((entry) => entry.kind === "character").map((entry) => entry.canonicalName);
      rows = work.episodes.flatMap((episode) => {
        const path = toStorePath(episode.filePath);
        return path ? [{ path, name: episodeName(path), conflicted: episode.hasConflictMarkers === true || undecided.has(path) }] : [];
      });
    } catch (error) {
      return fail(error instanceof Error ? error.message : String(error));
    }
    /** 話ごとの本文と、作るかどうか（読んだら覚える。走らせたら捨てる） */
    const plans = new Map<string, EpisodePlan>();
    const planOf = async (path: string): Promise<EpisodePlan> => {
      const known = plans.get(path);
      if (known) return known;
      const file = work.episodes.find((episode) => toStorePath(episode.filePath) === path);
      if (!file) throw new Error(`「${episodeName(path)}」が作品の話の一覧に見つかりません`);
      const content = await readTextFile(deps.store, path);
      const text = content.text.replace(/\r\n?/g, "\n");
      const plan: EpisodePlan = {
        path,
        fileName: file.fileName,
        chars: countChars(text, true, memoMarkers).net,
        conflicted: containsConflictMarkers(content.text) || undecided.has(path),
        parts: planSynopses(
          { fileName: file.fileName, chapterStart: file.chapterStart, title: file.subtitle ?? file.metaTitle, isInitialName: file.isInitialName, text },
          loaded.set,
          choice?.model ?? "",
          memoMarkers
        ),
      };
      plans.set(path, plan);
      return plan;
    };
    let selected: string[] = [deps.path];

    /*
      サブタイトル案を押す → 「この名前にします」→ ファイル名を変え、台帳を付け替える（1話ずつ）。名前が変わったら、この画面の
      話の一覧・選び・見積もりの元を新しい名前で読み直す（古い名前のまま走らせ直さない）
    */
    now.addEventListener("click", (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-rename-path]");
      if (!button) return;
      void (async () => {
        const from = button.dataset.renamePath!;
        const subtitle = button.dataset.renameSubtitle!;
        const fileName = from.slice(from.lastIndexOf("/") + 1);
        const next = renamedEpisodeFileName(fileName, subtitle);
        if (!next) return deps.toast("サブタイトルが空になりました");
        const ok = await askChoice(
          `「${fileName}」を「${next}」にします。本文は変えません。章立て・投稿状態・あらすじなど、この話を指す台帳も合わせます。名前を変えたことは、次の同期でパソコンへ送られます`,
          "この名前にします",
          "やめる"
        );
        if (!ok || !deps.stillHere()) return;
        const row = button.closest<HTMLElement>(".synopsis-row");
        const undecidedNow = await (deps.undecidedConflicts?.() ?? Promise.resolve<readonly string[]>([])).catch((): readonly string[] => []);
        const outcome = await renameEpisodeWithLedgers({
          store: deps.store,
          root: deps.root,
          path: from,
          subtitle,
          undecidedConflicts: undecidedNow,
          ...(deps.beforeWrite ? { beforeWrite: deps.beforeWrite } : {}),
        });
        // 断った訳は次の手を添えて長いので、閉じるまで残す窓で（控え・形の版・校閲中など）
        if (!outcome.ok) return tell(outcome.message);
        await deps.afterRename?.(from, outcome.newPath).catch(() => undefined);
        if (!deps.stillHere()) return;
        // この話のほかの案は、もう押せない（名前は1つ）
        row?.querySelectorAll<HTMLButtonElement>("[data-rename-path]").forEach((other) => (other.disabled = true));
        const status = row?.querySelector<HTMLElement>(".synopsis-renamed");
        if (status) status.textContent = [`ファイル名を「${outcome.newFileName}」にしました`, ...outcome.notes].join("。");
        // 古い名前で走らせ直さないよう、話の一覧と選びを読み直す
        selected = selected.map((path) => (path === from ? outcome.newPath : path));
        plans.clear();
        try {
          work = await scanWorkFolder(deps.store, deps.root);
          loaded = await loadSynopses(deps.store, settingsDir);
          rows = work.episodes.flatMap((episode) => {
            const path = toStorePath(episode.filePath);
            return path ? [{ path, name: episodeName(path), conflicted: episode.hasConflictMarkers === true || undecided.has(path) }] : [];
          });
        } catch {
          /* 読み直せなくても名前は変わっている。画面を開き直せば読む */
        }
      })();
    });

    const runAll = async (
      run: HTMLButtonElement,
      list: EpisodePlan[],
      calls: number,
      chars: number,
      chosen: NonNullable<typeof choice>,
      chosenProvider: NonNullable<typeof provider>
    ) => {
      const ok = await confirmPaidUsage({
        actionLabel: "あらすじ",
        providerId: chosenProvider.id,
        providerName: chosenProvider.displayName,
        model: chosen.model,
        notice: { sends: `本文 約${chars.toLocaleString("ja-JP")}字（${list.length}話）`, calls },
      });
      if (!ok || !deps.stillHere()) return;
      const key = await deps.vault.get(chosenProvider.secret);
      if (!key) return deps.toast("APIキーが見つかりません");
      run.disabled = true;
      slot.querySelector<HTMLButtonElement>("#typoPick")?.setAttribute("disabled", "");
      const progress = slot.querySelector<HTMLElement>("#typoProgress")!;
      const caller = typoCallerFor(chosenProvider.id, key, chosen.model);
      let done = 0;
      progress.textContent = `AI に見せています（0/${calls}）`;
      const made: { label: string; synopsis: string; subtitles: string[]; path: string }[] = [];
      const failures: { label: string; reason: string }[] = [];
      let saveFailure: string | undefined;
      // 止める印：画面を離れた（abort）か、iOS で裏に回った（paused）。頼んでいる1回は、画面を離れたときだけ止める（案A）
      const stopRun = new AbortController();
      const stopWithScreen = () => stopRun.abort();
      abort.signal.addEventListener("abort", stopWithScreen);
      let paused = false;
      /** 止めたときに、まだ作り終えていない最初の話（list の番号） */
      let interrupted = list.length;
      const onHidden = () => {
        if (document.visibilityState !== "hidden" || !(deps.pauseWhenHidden ?? Capacitor.getPlatform() === "ios")) return;
        paused = true;
        stopRun.abort();
      };
      document.addEventListener("visibilitychange", onHidden);
      try {
        await whileWorking(deps.background ?? backgroundWork(), list.length > 1 ? `あらすじ（${list.length}話）` : "あらすじ", calls, async (step) => {
          const counted: ModelCall = async (request) => {
            try {
              return await caller({ ...request, signal: abort.signal });
            } finally {
              done++;
              step(done);
              if (deps.stillHere()) progress.textContent = `AI に見せています（${done}/${calls}）`;
            }
          };
          for (const [index, plan] of list.entries()) {
            if (!plan.parts.some((part) => part.plan === "make")) continue;
            if (stopRun.signal.aborted) {
              interrupted = Math.min(interrupted, index);
              break;
            }
            // 前の話で書いた台帳の上に作る（前の話のあらすじに、この回で作ったものも渡る）
            const result = await runSynopses(plan.parts, { fileName: plan.fileName }, loaded.set, chosen.model, characterNames, counted, stopRun.signal);
            failures.push(...result.failures);
            // 合本で、区切りを全部頼む前に止めたなら、この話から走らせ直す（作れた区切りは下で書いて残す）
            const asked = plan.parts.filter((part) => part.plan === "make").length;
            if (stopRun.signal.aborted && result.calls < asked) interrupted = Math.min(interrupted, index);
            if (result.made.length === 0) continue;
            // 話ごとに書く（途中で止めても、作れた話は残る。呼んだ分を捨てない。本体と同じ）
            const saved = await saveSynopses(deps.store, settingsDir, result.set, loaded);
            if (!saved.ok) {
              saveFailure = saveFailureText(saved);
              break;
            }
            made.push(...result.made.map((item) => ({ label: item.label, synopsis: item.synopsis, subtitles: item.subtitles.map((s) => s.text), path: plan.path })));
            // 次の話を書くときの照らし合わせのため、いま書いた台帳を読み直す
            loaded = await loadSynopses(deps.store, settingsDir);
          }
        });
      } finally {
        document.removeEventListener("visibilitychange", onHidden);
        abort.signal.removeEventListener("abort", stopWithScreen);
      }
      plans.clear();
      // 話の名前（label）は原稿の題なので残さない。何件目かと理由だけ
      failures.forEach((failure, index) =>
        noteFailure("あらすじ", failure.reason, {
          種別: "AI に作ってもらえなかった",
          段: `${index + 1}件目`,
          使用中のAI: `${chosenProvider.displayName} / ${chosen.model}`,
        }),
      );
      if (saveFailure) noteFailure("あらすじ（保存）", saveFailure);
      if (!deps.stillHere()) return;
      if (saveFailure) {
        progress.textContent = made.length > 0 ? `${made.length}話のあらすじを書きました。${saveFailure}` : saveFailure;
        now.innerHTML = renderSynopsisList(made);
        return;
      }
      if (abort.signal.aborted) return;
      if (paused && interrupted < list.length) {
        // 残りの話だけを選び直して、見積もりから（払う前にもう一度確かめる）。作れた区切りは台帳にあるので作り直さない
        selected = list.slice(interrupted).map((plan) => plan.path);
        return showEstimate(`裏に回したので「${episodeName(list[interrupted]!.path)}」の前で止めました。続きを作りますか`);
      }
      progress.textContent =
        `${made.length}話のあらすじを書きました` + (failures.length > 0 ? `。${failures.map((f) => `${f.label}：${f.reason}`).join("／")}` : "");
      now.innerHTML = renderSynopsisList(made);
    };

    const showEstimate = async (notice?: string): Promise<void> => {
      let list: EpisodePlan[];
      try {
        list = await Promise.all(selected.map(planOf));
      } catch (error) {
        return fail(error instanceof Error ? error.message : String(error));
      }
      if (!deps.stillHere()) return;
      now.innerHTML = renderSynopsisList(
        list.flatMap((plan) =>
          plan.parts.flatMap((part) => {
            const existing = findSynopsis(loaded.set, plan.fileName, part.chapter);
            return existing ? [{ label: part.label, synopsis: existing.synopsis, byAuthor: !existing.autoGenerated }] : [];
          })
        )
      );
      const calls = list.reduce((sum, plan) => sum + plan.parts.filter((part) => part.plan === "make").length, 0);
      const chars = list.reduce((sum, plan) => sum + plan.chars, 0);
      const problem = list.some((plan) => plan.conflicted)
        ? "競合が残っている話には AI を当てません"
        : !choice || !provider
          ? "あらすじに使う AI がまだありません"
          : calls === 0
            ? "本文が変わっていないので、作り直しません"
            : undefined;
      const priceLine = choice && provider ? paidUsageNotice(provider.displayName, choice.model, { sends: "", calls }).lines[2]?.replace(/^料金[:：]\s*/, "") : undefined;
      slot.removeAttribute("aria-busy");
      slot.innerHTML =
        (notice ? `<p class="flag warn long" id="typoPaused">${escapeHtml(notice)}</p>` : "") +
        renderTypoEstimate({
          episode: pickedEpisodesText(selected.map(episodeName)),
          chars,
          ai: choice ? describeChoice(choice) : undefined,
          priceLine,
          aiSwitch: usable.size > 0,
          ...(problem ? { problem } : {}),
        }) +
        (rows.length > 1 ? `<div class="menu-items"><button class="menu-item built" id="typoPick">話を選ぶ</button></div>` : "");
      slot.querySelector<HTMLButtonElement>("#typoPick")?.addEventListener("click", () =>
        mountEpisodePicker(slot, rows, selected, (picked) => {
          selected = picked;
          void showEstimate();
        })
      );
      slot.querySelector<HTMLButtonElement>("#typoAi")?.addEventListener("click", () => {
        void chooseAiForRun(deps.vault, deps.toast).then((next) => {
          if (!next || !deps.stillHere()) return;
          choice = next;
          provider = CLOUD_PROVIDERS.find((candidate) => candidate.id === next.provider);
          // 作り直すかはモデルでも変わる（モデルが違えば作り直す。本体と同じ）
          plans.clear();
          void showEstimate(notice);
        });
      });
      const run = slot.querySelector<HTMLButtonElement>("#typoRun");
      if (!run || !choice || !provider || problem) return;
      // いまの選びで走らせる（押す前に AI の行で替えても、描き直してから押すので食い違わない）
      const chosen = choice;
      const chosenProvider = provider;
      run.addEventListener("click", () => void runAll(run, list, calls, chars, chosen, chosenProvider));
    };

    await showEstimate();
  })();
  return () => abort.abort();
}
