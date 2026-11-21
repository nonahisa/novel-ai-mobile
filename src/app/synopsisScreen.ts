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

/**
 * **各話あらすじを作る画面**（段2。2026-11-18。話の長押し → あらすじ）。
 *
 * 見積もり（話・字数・AI・料金）→ 有料の確認 → 作る → 台帳（`設定/chapter_synopses.json`）へ書く → 作ったあらすじを並べる。
 * 指摘ではないので［提案］へは出さない（本体と同じく台帳へ直に書く。作者が書いたものは触らない）。
 * サブタイトル案は見せるだけ（ファイル名は変えない）。AI は機能ごとの割り当ての「生成」（本体と同じ区分）。
 * **何話かまとめて**（2026-11-21）：誤字脱字・推敲と同じ［話を選ぶ］（1話ずつの印・［すべて］・範囲。2026-11-18 作者の答え）。
 * 話の一覧の並びで1話ずつ作り、**話ごとに台帳へ書く**（途中で止めても作れた話は残る）。前の話のあらすじには、その回で作ったものも渡す
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
}

/** いまの台帳の、この話のあらすじ（作者が書いたものには印） */
export function renderSynopsisList(rows: readonly { label: string; synopsis: string; byAuthor?: boolean; subtitles?: readonly string[] }[]): string {
  if (rows.length === 0) return "";
  const items = rows
    .map(
      (row) =>
        `<div class="synopsis-row"><dt>${escapeHtml(row.label)}${row.byAuthor ? `<span class="flag">作者</span>` : ""}</dt>` +
        `<dd>${escapeHtml(row.synopsis)}${row.subtitles && row.subtitles.length > 0 ? `<span class="synopsis-subtitles">${escapeHtml(`サブタイトル案：${row.subtitles.join("／")}`)}</span>` : ""}</dd></div>`
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
    const choice = decideFeatureAI("generate", assignments, defaultChoice, (id) => usable.has(id)).choice;
    const provider = choice ? CLOUD_PROVIDERS.find((candidate) => candidate.id === choice.provider) : undefined;
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

    const runAll = async (run: HTMLButtonElement, list: EpisodePlan[], calls: number, chars: number) => {
      if (!choice || !provider) return;
      const ok = await confirmPaidUsage({
        actionLabel: "あらすじ",
        providerId: provider.id,
        providerName: provider.displayName,
        model: choice.model,
        notice: { sends: `本文 約${chars.toLocaleString("ja-JP")}字（${list.length}話）`, calls },
      });
      if (!ok || !deps.stillHere()) return;
      const key = await deps.vault.get(provider.secret);
      if (!key) return deps.toast("APIキーが見つかりません");
      run.disabled = true;
      slot.querySelector<HTMLButtonElement>("#typoPick")?.setAttribute("disabled", "");
      const progress = slot.querySelector<HTMLElement>("#typoProgress")!;
      const caller = typoCallerFor(provider.id, key, choice.model);
      let done = 0;
      progress.textContent = `AI に見せています（0/${calls}）`;
      const made: { label: string; synopsis: string; subtitles: string[] }[] = [];
      const failures: { label: string; reason: string }[] = [];
      let saveFailure: string | undefined;
      await whileWorking(deps.background ?? backgroundWork(), list.length > 1 ? `あらすじ（${list.length}話）` : "あらすじ", calls, async (step) => {
        const counted: ModelCall = async (request) => {
          try {
            return await caller(request);
          } finally {
            done++;
            step(done);
            if (deps.stillHere()) progress.textContent = `AI に見せています（${done}/${calls}）`;
          }
        };
        for (const plan of list) {
          if (abort.signal.aborted) break;
          if (!plan.parts.some((part) => part.plan === "make")) continue;
          // 前の話で書いた台帳の上に作る（前の話のあらすじに、この回で作ったものも渡る）
          const result = await runSynopses(plan.parts, { fileName: plan.fileName }, loaded.set, choice.model, characterNames, counted, abort.signal);
          failures.push(...result.failures);
          if (result.made.length === 0) continue;
          // 話ごとに書く（途中で止めても、作れた話は残る。呼んだ分を捨てない。本体と同じ）
          const saved = await saveSynopses(deps.store, settingsDir, result.set, loaded);
          if (!saved.ok) {
            saveFailure = saveFailureText(saved);
            break;
          }
          made.push(...result.made.map((item) => ({ label: item.label, synopsis: item.synopsis, subtitles: item.subtitles.map((s) => s.text) })));
          // 次の話を書くときの照らし合わせのため、いま書いた台帳を読み直す
          loaded = await loadSynopses(deps.store, settingsDir);
        }
      });
      plans.clear();
      if (!deps.stillHere()) return;
      if (saveFailure) {
        progress.textContent = made.length > 0 ? `${made.length}話のあらすじを書きました。${saveFailure}` : saveFailure;
      } else {
        if (abort.signal.aborted) return;
        progress.textContent =
          `${made.length}話のあらすじを書きました` + (failures.length > 0 ? `。${failures.map((f) => `${f.label}：${f.reason}`).join("／")}` : "");
      }
      now.innerHTML = renderSynopsisList(made);
    };

    const showEstimate = async (): Promise<void> => {
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
        renderTypoEstimate({ episode: pickedEpisodesText(selected.map(episodeName)), chars, ai: choice ? describeChoice(choice) : undefined, priceLine, ...(problem ? { problem } : {}) }) +
        (rows.length > 1 ? `<div class="menu-items"><button class="menu-item built" id="typoPick">話を選ぶ</button></div>` : "");
      slot.querySelector<HTMLButtonElement>("#typoPick")?.addEventListener("click", () =>
        mountEpisodePicker(slot, rows, selected, (picked) => {
          selected = picked;
          void showEstimate();
        })
      );
      const run = slot.querySelector<HTMLButtonElement>("#typoRun");
      if (!run || problem) return;
      run.addEventListener("click", () => void runAll(run, list, calls, chars));
    };

    await showEstimate();
  })();
  return () => abort.abort();
}
