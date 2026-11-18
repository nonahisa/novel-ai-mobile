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
import { renderTypoEstimate } from "./typoScreen";
import { findSynopsis } from "../shared";

/**
 * **各話あらすじを作る画面**（段2。2026-11-18。話の長押し → あらすじ）。
 *
 * 見積もり（話・字数・AI・料金）→ 有料の確認 → 作る → 台帳（`設定/chapter_synopses.json`）へ書く → 作ったあらすじを並べる。
 * 指摘ではないので［提案］へは出さない（本体と同じく台帳へ直に書く。作者が書いたものは触らない）。
 * サブタイトル案は見せるだけ（ファイル名は変えない）。AI は機能ごとの割り当ての「生成」（本体と同じ区分）
 */

export interface SynopsisRunDeps {
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

function episodeName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1).replace(/\.txt$/i, "");
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
    let parts: SynopsisPart[];
    let loaded: LoadedSynopses;
    let characterNames: string[];
    let settingsDir: string;
    let fileName: string;
    let chars: number;
    const settings = await deps.settings;
    const usable = new Set<CloudProviderId>();
    for (const provider of CLOUD_PROVIDERS) if ((await deps.vault.get(provider.secret)) !== undefined) usable.add(provider.id);
    const { assignments, defaultChoice } = readAiChoices(settings);
    const choice = decideFeatureAI("generate", assignments, defaultChoice, (id) => usable.has(id)).choice;
    const provider = choice ? CLOUD_PROVIDERS.find((candidate) => candidate.id === choice.provider) : undefined;
    try {
      const content = await readTextFile(deps.store, deps.path);
      if (containsConflictMarkers(content.text)) return fail("競合が残っている話には AI を当てません");
      const [work, layout] = await Promise.all([scanWorkFolder(deps.store, deps.root), readWorkLayout(deps.store, deps.root)]);
      const file = work.episodes.find((episode) => toStorePath(episode.filePath) === deps.path);
      if (!file) return fail("この話が作品の話の一覧に見つかりません");
      settingsDir = layout.settings;
      fileName = file.fileName;
      loaded = await loadSynopses(deps.store, settingsDir);
      characterNames = (await readWorkTerms(deps.store, settingsDir)).entries.filter((entry) => entry.kind === "character").map((entry) => entry.canonicalName);
      const text = content.text.replace(/\r\n?/g, "\n");
      chars = countChars(text, true, layout.memoMarkers).net;
      parts = planSynopses(
        { fileName: file.fileName, chapterStart: file.chapterStart, title: file.subtitle ?? file.metaTitle, isInitialName: file.isInitialName, text },
        loaded.set,
        choice?.model ?? "",
        layout.memoMarkers
      );
    } catch (error) {
      return fail(error instanceof Error ? error.message : String(error));
    }
    if (!deps.stillHere()) return;
    const showNow = () => {
      now.innerHTML = renderSynopsisList(
        parts.flatMap((part) => {
          const existing = findSynopsis(loaded.set, fileName, part.chapter);
          return existing ? [{ label: part.label, synopsis: existing.synopsis, byAuthor: !existing.autoGenerated }] : [];
        })
      );
    };
    showNow();
    const calls = parts.filter((part) => part.plan === "make").length;
    const problem = !choice || !provider ? "あらすじに使う AI がまだありません" : calls === 0 ? "本文が変わっていないので、作り直しません" : undefined;
    const priceLine = choice && provider ? paidUsageNotice(provider.displayName, choice.model, { sends: "", calls }).lines[2]?.replace(/^料金[:：]\s*/, "") : undefined;
    slot.removeAttribute("aria-busy");
    slot.innerHTML = renderTypoEstimate({ episode: episodeName(deps.path), chars, ai: choice ? describeChoice(choice) : undefined, priceLine, ...(problem ? { problem } : {}) });
    const run = slot.querySelector<HTMLButtonElement>("#typoRun");
    if (!run || !choice || !provider || problem) return;
    run.addEventListener("click", () => {
      void (async () => {
        const ok = await confirmPaidUsage({
          actionLabel: "あらすじ",
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
        const counted: ModelCall = async (request) => {
          try {
            return await caller(request);
          } finally {
            done++;
            if (deps.stillHere()) progress.textContent = `AI に見せています（${done}/${calls}）`;
          }
        };
        const result = await whileWorking(deps.background ?? backgroundWork(), "あらすじ", calls, (step) =>
          runSynopses(parts, { fileName }, loaded.set, choice.model, characterNames, async (request) => {
            try {
              return await counted(request);
            } finally {
              step(done);
            }
          }, abort.signal)
        );
        // 途中で止めても、作れたぶんは書く（呼んだ分を捨てない。本体と同じ）
        if (result.made.length > 0) {
          const saved = await saveSynopses(deps.store, settingsDir, result.set, loaded);
          if (!saved.ok) {
            if (deps.stillHere()) progress.textContent = saveFailureText(saved);
            return;
          }
        }
        if (!deps.stillHere() || abort.signal.aborted) return;
        progress.textContent =
          `${result.made.length}話のあらすじを書きました` +
          (result.failures.length > 0 ? `。${result.failures.map((f) => `${f.label}：${f.reason}`).join("／")}` : "");
        now.innerHTML = renderSynopsisList(result.made.map((made) => ({ label: made.label, synopsis: made.synopsis, subtitles: made.subtitles.map((s) => s.text) })));
      })();
    });
  })();
  return () => abort.abort();
}
