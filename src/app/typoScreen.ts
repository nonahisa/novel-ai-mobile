import { containsConflictMarkers, countChars, decideFeatureAI, paidUsageNotice } from "../shared";
import { describeChoice, readAiChoices } from "../platform/aiAssignment";
import { CLOUD_PROVIDERS, type CloudProviderId } from "../platform/aiKeys";
import type { DeviceSettings } from "../platform/deviceSettings";
import type { FileStore } from "../platform/fileStore";
import type { SecretVault } from "../platform/secretVault";
import { readTextFile } from "../platform/textFile";
import { checkEpisodeTypos, typoCheckChunks, type ModelCall, type TypoCheckInput, type TypoCheckResult } from "../platform/typoCheck";
import { checkEpisodeProofread, readKeepWords } from "../platform/proofreadCheck";
import type { KeepWord } from "../shared";
import { typoCallerFor } from "../platform/typoCallers";
import { chooseAiForRun } from "./aiChoose";
import { readWorkLayout, scanWorkFolder } from "../platform/workScan";
import { toStorePath } from "../platform/paths";
import { backgroundWork, whileWorking, type BackgroundWork } from "../platform/backgroundWork";
import { Capacitor } from "@capacitor/core";
import { readSeriesTerms, readWorkTerms } from "../platform/workTerms";
import { escapeHtml, renderAppBar } from "./menuScreen";
import { confirmPaidUsage } from "./paidConfirm";
import { addProposals, readProposals, replaceEpisodeProposals, writeProposals } from "./typoProposals";

/**
 * **誤字脱字を走らせる画面**（段2。走らせる前の見積もり＝画面 F。設計書 7章）。
 * 1枚に「何話・約何字・どの AI・費用の目安」の4行。［走らせる］で有料の AI の確認の窓（本体の文言）→ 走らせる →
 * 指摘は［提案］へ。**競合が残っている話には AI を当てない**（設計書 6章）。作品の設定が壊れていれば止める（既定へ戻さない）
 */

export interface TypoRunDeps {
  /** 誤字脱字か推敲か（見積もり・確認・走らせ方は同じ。頼む文と指摘の種類が違う） */
  check: "typo" | "proofread";
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
  /** 裏に回っても続けるための口（試験で差し替える。既定は端末に合ったもの） */
  background?: BackgroundWork;
  /**
   * 裏に回ったら、いまの1区切りで止めるか（既定は iOS だけ。試験で差し替える）。
   * 【決定】2026-11-18 作者の答え「案A」：iOS には前面サービスが無いので、裏に回ったら次の区切りを頼まずに止め、
   * 戻ったら「裏に回したので○○の途中で止めました。続きを走らせますか」と出して残りの話だけ走らせ直せる
   */
  pauseWhenHidden?: boolean;
}

/** 4行の見積もり（DOM の無い試験で中身を確かめる） */
export function renderTypoEstimate(view: {
  episode: string;
  chars: number;
  ai: string | undefined;
  priceLine: string | undefined;
  problem?: string;
  /** AI の行を押して、その回だけ別の AI に替えられるか（設計書 7章 F） */
  aiSwitch?: boolean;
}): string {
  const rows = [
    ["話", view.episode],
    ["字数", `約${view.chars.toLocaleString("ja-JP")}字`],
    ["AI", view.ai ?? "まだ選んでいません"],
    ["料金", view.priceLine ?? "—"],
  ]
    .map(([label, value]) =>
      label === "AI" && view.aiSwitch
        ? `<div class="estimate-row"><dt>AI</dt><dd><button type="button" class="estimate-switch" id="typoAi">${escapeHtml(value!)}</button></dd></div>`
        : `<div class="estimate-row"><dt>${escapeHtml(label!)}</dt><dd>${escapeHtml(value!)}</dd></div>`
    )
    .join("");
  const action = view.problem
    ? `<p class="flag shu long" id="typoProblem">${escapeHtml(view.problem)}</p>` + (view.ai ? "" : `<div class="menu-items"><button class="menu-item built" data-screen="ai">AI の設定</button></div>`)
    : `<div class="draft-actions"><button class="primary" id="typoRun">走らせる</button></div>`;
  return `<dl class="estimate">${rows}</dl>${action}<p class="sync-result" id="typoProgress" role="status"></p><div id="typoAfter"></div>`;
}

/** 走らせたあとの1行（失敗は「0件」にしない） */
export function typoResultText(result: TypoCheckResult): string {
  const head = `指摘 ${result.findings.length}件` + (result.rejected > 0 ? `（本文と合わない ${result.rejected}件は外しました）` : "");
  if (result.failures.length === 0) return head;
  return `${head}。${result.failures.length}か所は AI に見てもらえませんでした：${result.failures.map((f) => f.reason).join("／")}`;
}

export function episodeName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1).replace(/\.txt$/i, "");
}

/** 選ぶ画面の1行（話の名前と、選べるか） */
export interface PickRow {
  path: string;
  name: string;
  /** 競合が残っている話は選べない */
  conflicted: boolean;
}

/**
 * **何話かまとめて選ぶ**（2026-11-18 母艦の順 C）。見積もりの［話を選ぶ］で開く。話の一覧の並び（本体の `compareEpisodes`）で、
 * 1行に1話。上に［すべて］、下に［決める］。競合が残っている話は選べない（AI を当てない。設計書 6章）
 */
export function renderEpisodePicker(rows: readonly PickRow[], selected: ReadonlySet<string>): string {
  const choosable = rows.filter((row) => !row.conflicted);
  const all = choosable.length > 0 && choosable.every((row) => selected.has(row.path));
  const items = rows
    .map(
      (row) =>
        `<label class="pick-row${row.conflicted ? " disabled" : ""}"><input type="checkbox" data-pick="${escapeHtml(row.path)}"${selected.has(row.path) ? " checked" : ""}${row.conflicted ? " disabled" : ""} />` +
        `<span class="pick-name">${escapeHtml(row.name)}</span>${row.conflicted ? `<span class="flag shu">競合</span>` : ""}</label>`
    )
    .join("");
  // 範囲で選ぶ（2026-11-18 作者の答え「範囲（第○話〜第○話）でも選べるように」）。話の一覧の並びで頭と末を選ぶ（欠番があってもずれない）
  const options = (pick: number) =>
    rows.map((row, index) => `<option value="${index}"${index === pick ? " selected" : ""}>${escapeHtml(row.name)}</option>`).join("");
  const indices = rows.map((row, index) => (selected.has(row.path) ? index : -1)).filter((index) => index >= 0);
  const from = indices.length > 0 ? Math.min(...indices) : 0;
  const to = indices.length > 0 ? Math.max(...indices) : rows.length - 1;
  const range =
    rows.length > 2
      ? `<div class="pick-range"><select id="pickFrom" aria-label="頭の話">${options(from)}</select><span aria-hidden="true">〜</span><select id="pickTo" aria-label="末の話">${options(to)}</select><button type="button" id="pickRangeApply">この範囲を選ぶ</button></div>`
      : "";
  return (
    range +
    `<div class="pick-head"><label class="pick-row"><input type="checkbox" id="pickAll"${all ? " checked" : ""} /><span class="pick-name">すべて</span></label></div>` +
    `<div class="pick-list">${items}</div>` +
    `<div class="draft-actions"><button class="primary" id="pickDone"${selected.size === 0 ? " disabled" : ""}>決める</button></div>`
  );
}

/** 話の一覧の並びで a 番目から b 番目まで（逆でもよい）の、選べる話 */
export function pathsInRange(rows: readonly PickRow[], a: number, b: number): string[] {
  const [lo, hi] = a <= b ? [a, b] : [b, a];
  return rows.slice(lo, hi + 1).filter((row) => !row.conflicted).map((row) => row.path);
}

/** 見積もりの「話」の行（1話ならその名前、何話かなら数と頭の話） */
export function pickedEpisodesText(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.length}話（${names[0]} ほか）`;
}

/**
 * ［話を選ぶ］の画面を `slot` に出し、［決める］で選んだ話（話の一覧の並びのまま）を `done` へ渡す。
 * 誤字脱字・推敲とあらすじで同じ選び方（1話ずつの印・［すべて］・範囲）を使う
 */
export function mountEpisodePicker(slot: HTMLElement, rows: readonly PickRow[], initial: readonly string[], done: (picked: string[]) => void): void {
  const picked = new Set(initial);
  const paint = () => {
    slot.innerHTML = renderEpisodePicker(rows, picked);
  };
  paint();
  slot.onchange = (event) => {
    const box = event.target as HTMLInputElement;
    // 範囲の頭と末を選んだだけでは描き直さない（描き直すと、もう片方の選びが戻る）
    if (box.tagName === "SELECT") return;
    if (box.id === "pickAll") {
      for (const row of rows) if (!row.conflicted) box.checked ? picked.add(row.path) : picked.delete(row.path);
    } else if (box.dataset.pick) {
      box.checked ? picked.add(box.dataset.pick) : picked.delete(box.dataset.pick);
    }
    paint();
  };
  slot.onclick = (event) => {
    if ((event.target as HTMLElement).id === "pickRangeApply") {
      // 選んだ範囲の話だけにする（競合の話は飛ばす）。頭と末が逆でも並びのまま
      const a = Number(slot.querySelector<HTMLSelectElement>("#pickFrom")!.value);
      const b = Number(slot.querySelector<HTMLSelectElement>("#pickTo")!.value);
      picked.clear();
      for (const path of pathsInRange(rows, a, b)) picked.add(path);
      paint();
      return;
    }
    if ((event.target as HTMLElement).id !== "pickDone" || picked.size === 0) return;
    slot.onchange = null;
    slot.onclick = null;
    done(rows.filter((row) => picked.has(row.path)).map((row) => row.path));
  };
}

export function mountTypoRun(screen: HTMLElement, deps: TypoRunDeps): () => void {
  const label = deps.check === "typo" ? "誤字脱字" : "推敲";
  screen.innerHTML = `${renderAppBar(label, { back: true })}<div id="typoSlot" aria-busy="true"></div>`;
  const slot = screen.querySelector<HTMLElement>("#typoSlot")!;
  const abort = new AbortController();
  const fail = (error: unknown) => {
    if (deps.stillHere()) slot.innerHTML = `<p class="flag shu long">${escapeHtml(error instanceof Error ? error.message : String(error))}</p>`;
  };
  void (async () => {
    // 作品の中で1度だけ読むもの（作品の作法・用語・直さない語・話の一覧）
    let memoMarkers: TypoCheckInput["memoMarkers"];
    let properNouns: string[];
    let keepWords: KeepWord[];
    let rows: PickRow[];
    let undecided = new Set<string>();
    try {
      const [layout, work] = await Promise.all([readWorkLayout(deps.store, deps.root), scanWorkFolder(deps.store, deps.root)]);
      memoMarkers = layout.memoMarkers;
      const own = (await readWorkTerms(deps.store, layout.settings)).entries;
      const series = await readSeriesTerms(deps.store, deps.root).catch(() => []);
      properNouns = [...own, ...series].map((entry) => entry.text);
      keepWords = await readKeepWords(deps.store, layout.settings);
      undecided = new Set(await (deps.undecidedConflicts?.() ?? Promise.resolve<readonly string[]>([])).catch((): readonly string[] => []));
      rows = work.episodes.flatMap((episode) => {
        const path = toStorePath(episode.filePath);
        return path ? [{ path, name: episodeName(path), conflicted: episode.hasConflictMarkers === true || undecided.has(path) }] : [];
      });
      if (!rows.some((row) => row.path === deps.path)) rows.unshift({ path: deps.path, name: episodeName(deps.path), conflicted: undecided.has(deps.path) });
    } catch (error) {
      return fail(error);
    }
    /** 話ごとの本文（読んだら覚える） */
    const inputs = new Map<string, { input: TypoCheckInput; conflicted: boolean }>();
    const inputOf = async (path: string) => {
      const known = inputs.get(path);
      if (known) return known;
      const content = await readTextFile(deps.store, path);
      const loaded = {
        input: { path, text: content.text.replace(/\r\n?/g, "\n"), memoMarkers, properNouns, keepWords },
        conflicted: containsConflictMarkers(content.text) || undecided.has(path),
      };
      inputs.set(path, loaded);
      return loaded;
    };
    const settings = await deps.settings;
    const usable = new Set<CloudProviderId>();
    for (const provider of CLOUD_PROVIDERS) if ((await deps.vault.get(provider.secret)) !== undefined) usable.add(provider.id);
    const { assignments, defaultChoice } = readAiChoices(settings);
    // その回だけ替えられる（見積もりの AI の行を押す。設定は変えない）
    let choice = decideFeatureAI(deps.check, assignments, defaultChoice, (id) => usable.has(id)).choice;
    let provider = choice ? CLOUD_PROVIDERS.find((candidate) => candidate.id === choice!.provider) : undefined;
    let selected: string[] = [deps.path];

    const runAll = async (
      run: HTMLButtonElement,
      list: TypoCheckInput[],
      calls: number,
      chars: number,
      chosen: NonNullable<typeof choice>,
      chosenProvider: NonNullable<typeof provider>
    ) => {
      const ok = await confirmPaidUsage({
        actionLabel: label,
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
      const total: TypoCheckResult = { findings: [], failures: [], calls: 0, rejected: 0 };
      // 止める印：画面を離れた（abort）か、iOS で裏に回った（paused）
      const stopRun = new AbortController();
      const stopWithScreen = () => stopRun.abort();
      abort.signal.addEventListener("abort", stopWithScreen);
      let paused = false;
      let interrupted = list.length;
      const onHidden = () => {
        if (document.visibilityState !== "hidden" || !(deps.pauseWhenHidden ?? Capacitor.getPlatform() === "ios")) return;
        paused = true;
        stopRun.abort();
      };
      document.addEventListener("visibilitychange", onHidden);
      try {
        // 走らせているあいだは、アプリを裏に回しても続ける（Android の前面サービスと通知。設計書 7章）
        await whileWorking(deps.background ?? backgroundWork(), `${label}（${list.length}話）`, calls, async (step) => {
          const counted: ModelCall = async (request) => {
            try {
              // 頼んでいる1回は、裏に回っても止めない（案A「いまの1区切りだけ終わらせる」）。止めるのは画面を離れたときだけ
              return await caller({ ...request, signal: abort.signal });
            } finally {
              done++;
              step(done);
              if (deps.stillHere()) progress.textContent = `AI に見せています（${done}/${calls}）`;
            }
          };
          for (const [index, input] of list.entries()) {
            if (stopRun.signal.aborted) {
              interrupted = Math.min(interrupted, index);
              break;
            }
            const result: TypoCheckResult =
              deps.check === "typo"
                ? await checkEpisodeTypos(input, counted, stopRun.signal)
                : await checkEpisodeProofread({ path: input.path, text: input.text, memoMarkers: input.memoMarkers, keepWords }, counted, stopRun.signal);
            // 区切りを全部見終わる前に止めたなら、この話から走らせ直す（見られた区切りの指摘は足して残す）。
            // 最後の区切りを頼んでいるあいだに止めたのなら、この話は見終わっている
            const unfinished = stopRun.signal.aborted && result.calls < typoCheckChunks(input).length;
            if (unfinished) interrupted = Math.min(interrupted, index);
            // 話ごとに、すぐ［提案］へ書く（途中で止めても、見られた話の指摘は残る。払った分を捨てない）。
            // 前の指摘はこの話の同じ種類だけ入れ替える。途中で画面を離れたら、前の指摘は消さずに足すだけ
            const before = readProposals(globalThis.localStorage);
            writeProposals(
              globalThis.localStorage,
              unfinished
                ? addProposals(before, deps.root, result.findings, deps.check)
                : replaceEpisodeProposals(before, deps.root, input.path, result.findings, deps.check)
            );
            total.findings.push(...result.findings);
            total.failures.push(...result.failures);
            total.calls += result.calls;
            total.rejected += result.rejected;
          }
        });
      } finally {
        document.removeEventListener("visibilitychange", onHidden);
        abort.signal.removeEventListener("abort", stopWithScreen);
      }
      if (abort.signal.aborted || !deps.stillHere()) return;
      if (paused && interrupted < list.length) {
        // 残りの話だけを選び直して、見積もりから（払う前にもう一度確かめる）
        selected = list.slice(interrupted).map((input) => input.path);
        return showEstimate(`裏に回したので「${episodeName(list[interrupted]!.path)}」の途中で止めました。続きを走らせますか`);
      }
      progress.textContent = typoResultText(total);
      slot.querySelector<HTMLElement>("#typoAfter")!.innerHTML = `<div class="menu-items"><button class="menu-item built" data-tab="proposals">提案を見る</button></div>`;
    };

    const showEstimate = async (notice?: string): Promise<void> => {
      let loaded: { input: TypoCheckInput; conflicted: boolean }[];
      try {
        loaded = await Promise.all(selected.map(inputOf));
      } catch (error) {
        return fail(error);
      }
      if (!deps.stillHere()) return;
      const conflicted = loaded.some((item) => item.conflicted);
      const calls = loaded.reduce((sum, item) => sum + typoCheckChunks(item.input).length, 0);
      const chars = loaded.reduce((sum, item) => sum + countChars(item.input.text, true, item.input.memoMarkers).net, 0);
      const problem = conflicted
        ? "競合が残っている話には AI を当てません"
        : !choice || !provider
          ? `${label}に使う AI がまだありません`
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
        }) + (rows.length > 1 ? `<div class="menu-items"><button class="menu-item built" id="typoPick">話を選ぶ</button></div>` : "");
      slot.querySelector<HTMLButtonElement>("#typoPick")?.addEventListener("click", showPicker);
      slot.querySelector<HTMLButtonElement>("#typoAi")?.addEventListener("click", () => {
        void chooseAiForRun(deps.vault, deps.toast).then((next) => {
          if (!next || !deps.stillHere()) return;
          choice = next;
          provider = CLOUD_PROVIDERS.find((candidate) => candidate.id === next.provider);
          void showEstimate(notice);
        });
      });
      const run = slot.querySelector<HTMLButtonElement>("#typoRun");
      if (!run || !choice || !provider || problem) return;
      // いまの選びで走らせる（押す前に AI の行で替えても、描き直してから押すので食い違わない）
      const chosen = choice;
      const chosenProvider = provider;
      run.addEventListener("click", () => void runAll(run, loaded.map((item) => item.input), calls, chars, chosen, chosenProvider));
    };

    const showPicker = () =>
      mountEpisodePicker(slot, rows, selected, (picked) => {
        selected = picked;
        void showEstimate();
      });

    await showEstimate();
  })();
  return () => abort.abort();
}
