import { containsConflictMarkers, countChars, decideFeatureAI, paidUsageNotice } from "../shared";
import { describeChoice, readAiChoices } from "../platform/aiAssignment";
import { CLOUD_PROVIDERS, type CloudProviderId } from "../platform/aiKeys";
import type { DeviceSettings } from "../platform/deviceSettings";
import type { FileStore } from "../platform/fileStore";
import type { SecretVault } from "../platform/secretVault";
import { readTextFile } from "../platform/textFile";
import { checkEpisodeTypos, typoCheckChunks, type TypoCheckInput, type TypoCheckResult } from "../platform/typoCheck";
import { typoCallerFor } from "../platform/typoCallers";
import { readWorkLayout } from "../platform/workScan";
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
  store: FileStore;
  root: string;
  path: string;
  settings: Promise<DeviceSettings>;
  vault: SecretVault;
  toast: (text: string) => void;
  stillHere: () => boolean;
}

/** 4行の見積もり（DOM の無い試験で中身を確かめる） */
export function renderTypoEstimate(view: { episode: string; chars: number; ai: string | undefined; priceLine: string | undefined; problem?: string }): string {
  const rows = [
    ["話", view.episode],
    ["字数", `約${view.chars.toLocaleString("ja-JP")}字`],
    ["AI", view.ai ?? "まだ選んでいません"],
    ["料金", view.priceLine ?? "—"],
  ]
    .map(([label, value]) => `<div class="estimate-row"><dt>${escapeHtml(label!)}</dt><dd>${escapeHtml(value!)}</dd></div>`)
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

function episodeName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1).replace(/\.txt$/i, "");
}

export function mountTypoRun(screen: HTMLElement, deps: TypoRunDeps): () => void {
  screen.innerHTML = `${renderAppBar("誤字脱字", { back: true })}<div id="typoSlot" aria-busy="true"></div>`;
  const slot = screen.querySelector<HTMLElement>("#typoSlot")!;
  const abort = new AbortController();
  void (async () => {
    let input: TypoCheckInput;
    let conflicted = false;
    try {
      const [content, layout] = await Promise.all([readTextFile(deps.store, deps.path), readWorkLayout(deps.store, deps.root)]);
      conflicted = containsConflictMarkers(content.text);
      const own = (await readWorkTerms(deps.store, layout.settings)).entries;
      const series = await readSeriesTerms(deps.store, deps.root).catch(() => []);
      input = {
        path: deps.path,
        text: content.text.replace(/\r\n?/g, "\n"),
        memoMarkers: layout.memoMarkers,
        properNouns: [...own, ...series].map((entry) => entry.text),
      };
    } catch (error) {
      if (deps.stillHere()) slot.innerHTML = `<p class="flag shu long">${escapeHtml(error instanceof Error ? error.message : String(error))}</p>`;
      return;
    }
    const settings = await deps.settings;
    const usable = new Set<CloudProviderId>();
    for (const provider of CLOUD_PROVIDERS) if ((await deps.vault.get(provider.secret)) !== undefined) usable.add(provider.id);
    const { assignments, defaultChoice } = readAiChoices(settings);
    const decision = decideFeatureAI("typo", assignments, defaultChoice, (id) => usable.has(id));
    const choice = decision.choice;
    const calls = typoCheckChunks(input).length;
    const chars = countChars(input.text, true, input.memoMarkers).net;
    const provider = choice ? CLOUD_PROVIDERS.find((candidate) => candidate.id === choice.provider) : undefined;
    const problem = conflicted
      ? "競合が残っている話には AI を当てません"
      : !choice || !provider
        ? "誤字脱字に使う AI がまだありません"
        : undefined;
    const priceLine = choice && provider ? paidUsageNotice(provider.displayName, choice.model, { sends: "", calls }).lines[2]?.replace(/^料金[:：]\s*/, "") : undefined;
    if (!deps.stillHere()) return;
    slot.removeAttribute("aria-busy");
    slot.innerHTML = renderTypoEstimate({
      episode: episodeName(deps.path),
      chars,
      ai: choice ? describeChoice(choice) : undefined,
      priceLine,
      ...(problem ? { problem } : {}),
    });
    const run = slot.querySelector<HTMLButtonElement>("#typoRun");
    if (!run || !choice || !provider || problem) return;
    run.addEventListener("click", () => {
      void (async () => {
        const ok = await confirmPaidUsage({
          actionLabel: "誤字脱字",
          providerId: provider.id,
          providerName: provider.displayName,
          model: choice.model,
          notice: { sends: `本文 約${chars.toLocaleString("ja-JP")}字（1話）`, calls },
        });
        if (!ok || !deps.stillHere()) return;
        const key = await deps.vault.get(provider.secret);
        if (!key) return deps.toast("APIキーが見つかりません");
        run.disabled = true;
        const progress = slot.querySelector<HTMLElement>("#typoProgress")!;
        const caller = typoCallerFor(provider.id, key, choice.model);
        let done = 0;
        progress.textContent = `AI に見せています（0/${calls}）`;
        const result = await checkEpisodeTypos(
          input,
          async (request) => {
            try {
              return await caller(request);
            } finally {
              done++;
              if (deps.stillHere()) progress.textContent = `AI に見せています（${done}/${calls}）`;
            }
          },
          abort.signal
        );
        // 失敗した区切りがあっても、見られた所の指摘は残す（払った分を捨てない）。前の指摘はこの話の分だけ入れ替える。
        // 途中で画面を離れたら、前の指摘は消さずに足すだけ（見ていない所の指摘が残るように）
        const before = readProposals(globalThis.localStorage);
        writeProposals(
          globalThis.localStorage,
          abort.signal.aborted ? addProposals(before, deps.root, result.findings) : replaceEpisodeProposals(before, deps.root, deps.path, result.findings)
        );
        if (abort.signal.aborted) return;
        if (!deps.stillHere()) return;
        progress.textContent = typoResultText(result);
        slot.querySelector<HTMLElement>("#typoAfter")!.innerHTML = `<div class="menu-items"><button class="menu-item built" data-tab="proposals">提案を見る</button></div>`;
      })();
    });
  })();
  return () => abort.abort();
}
