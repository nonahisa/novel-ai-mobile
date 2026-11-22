import { decideFeatureAI, paidUsageNotice } from "../shared";
import { describeChoice, readAiChoices } from "../platform/aiAssignment";
import { CLOUD_PROVIDERS, type CloudProviderId } from "../platform/aiKeys";
import { backgroundWork, whileWorking, type BackgroundWork } from "../platform/backgroundWork";
import type { DeviceSettings } from "../platform/deviceSettings";
import type { FileStore } from "../platform/fileStore";
import {
  applyEnrichRows,
  isEnrichKind,
  placeMisattributed,
  prepareEnrich,
  refreshDestinations,
  runEnrich,
  saveRecord,
  saveRecordFailureText,
  type EnrichOutcome,
  type MisattributedItem,
  type PrepareEnrichInput,
} from "../platform/materialEnrich";
import type { SecretVault } from "../platform/secretVault";
import { typoCallerFor } from "../platform/typoCallers";
import { readWorkLayout, scanWorkFolder } from "../platform/workScan";
import { chooseAiForRun } from "./aiChoose";
import { escapeHtml, renderAppBar } from "./menuScreen";
import { confirmPaidUsage } from "./paidConfirm";

/**
 * **設定資料の1件を本文から読み直す画面**（`#/materials/<作品>/<種類>/<id>/enrich`。2026-11-22 作者の答え
 * 「本文から読み直すまで作る」。本体の設定資料パネルの［AIで再読込］と同じ流れ：設計書 6.31）。
 *
 * 留意点（空でもよい）→ 見積もり（本文の抜粋の字数・AI・料金）→ 有料の確認 → AI に頼む → 案（いまの値と並べる。
 * 手で直せる）→ 選んで［選んだ項目を反映］。**選んで押すまで資料は書かない**（本体と同じ承認制）。既定で選ぶのは
 * 空欄を埋める案だけ。AI は機能ごとの割り当ての「抽出」（本体と同じ区分）。仕組みは `platform/materialEnrich.ts`
 */

export interface MaterialEnrichDeps {
  store: FileStore;
  root: string;
  kind: string;
  id: string;
  settings: Promise<DeviceSettings>;
  vault: SecretVault;
  toast: (text: string) => void;
  stillHere: () => boolean;
  /** 同期で競合したまま選んでいない話（その本文は渡さない） */
  undecidedConflicts?: () => Promise<readonly string[]>;
  /** 書く直前に、その道をアプリが書いた控えへ（`touchedPaths.ts`） */
  beforeWrite?: (path: string) => Promise<void>;
  /** 反映したあと・破棄したときに戻る所（1件の画面） */
  done: () => void;
  background?: BackgroundWork;
  now?: () => string;
}

export const ENRICH_NOTES_EXAMPLE = "例：他の登場人物〇〇の情報が混入しています。";
export const ENRICH_NOTHING = "新しい案はありませんでした";

export function renderEnrichOutcome(outcome: EnrichOutcome): string {
  const rows = outcome.rows
    .map((row) => {
      const field = row.multiline
        ? `<textarea class="enrich-after" rows="3">${escapeHtml(row.after)}</textarea>`
        : `<input class="enrich-after" type="text" value="${escapeHtml(row.after)}">`;
      return (
        `<div class="enrich-row" data-key="${escapeHtml(row.key)}">` +
        `<label class="enrich-pick"><input type="checkbox" class="enrich-check"${row.fillsBlank ? " checked" : ""}><span>${escapeHtml(row.label)}</span>` +
        `${row.fillsBlank ? "" : `<span class="flag warn">現在の内容を置き換えます</span>`}</label>` +
        `${row.before ? `<p class="enrich-before">現在：${escapeHtml(row.before)}</p>` : ""}${field}</div>`
      );
    })
    .join("");
  const held =
    outcome.heldBack.length > 0
      ? `<section class="enrich-held"><h3>作者の資料の書かれた欄なので、案にしなかったもの</h3><ul>${outcome.heldBack
          .map((item) => `<li><b>${escapeHtml(item.label)}</b>：${escapeHtml(item.after)}</li>`)
          .join("")}</ul></section>`
      : "";
  const dropped =
    outcome.dropped.length > 0 ? `<section class="enrich-dropped"><h3>検算で外した案</h3><ul>${outcome.dropped.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ul></section>` : "";
  const misattributed =
    outcome.misattributed.length > 0
      ? `<section class="enrich-misattributed"><h3>この資料のものではない、と AI が判断した記述</h3><p class="enrich-note">${
          outcome.misattributed.some((entry) => entry.destination)
            ? "押すと、その人物の資料へ入れます（書かれている値は上書きしません）"
            : "行き先の資料へ入れられるのは、登場人物を読み直したときだけです"
        }</p><ul>${outcome.misattributed.map((entry, index) => renderMisattributed(entry, index)).join("")}</ul></section>`
      : "";
  const actions =
    outcome.rows.length > 0
      ? `<div class="draft-actions"><button class="primary" id="enrichApply">選んだ項目を反映</button><button id="enrichDiscard">破棄</button></div>`
      : `<p class="enrich-nothing">${ENRICH_NOTHING}</p><div class="draft-actions"><button id="enrichDiscard">戻る</button></div>`;
  return `<div class="enrich-rows">${rows}</div>${actions}${held}${dropped}${misattributed}`;
}

/** はじいた記述の1件（行き先があれば、入れるボタン） */
export function renderMisattributed(entry: MisattributedItem, index: number): string {
  const place = entry.destination
    ? `<button type="button" class="enrich-place" data-index="${index}">${escapeHtml(
        entry.destination.kind === "existing" ? `「${entry.destination.name}」へ入れる` : `「${entry.destination.name}」を新しく起こして入れる`
      )}</button>`
    : "";
  return `<li data-index="${index}"><b>${escapeHtml(entry.belongsTo)}</b>の${escapeHtml(entry.fieldLabel)}：${escapeHtml(entry.value)}<span class="enrich-evidence">「${escapeHtml(entry.evidence)}」</span>${place}</li>`;
}

/** 画面の案から、選んだ項目と（直した）値を集める */
export function chosenValues(container: HTMLElement): Record<string, string> {
  const chosen: Record<string, string> = {};
  container.querySelectorAll<HTMLElement>(".enrich-row").forEach((row) => {
    if (!row.querySelector<HTMLInputElement>(".enrich-check")?.checked) return;
    const value = row.querySelector<HTMLInputElement | HTMLTextAreaElement>(".enrich-after")?.value.trim() ?? "";
    if (value) chosen[row.dataset.key!] = value;
  });
  return chosen;
}

export function mountMaterialEnrich(screen: HTMLElement, deps: MaterialEnrichDeps): () => void {
  screen.innerHTML = `${renderAppBar("本文から読み直す", { back: true })}<div class="enrich" id="enrichSlot" aria-busy="true"></div>`;
  const slot = screen.querySelector<HTMLElement>("#enrichSlot")!;
  const abort = new AbortController();
  const fail = (message: string) => {
    if (!deps.stillHere()) return;
    slot.removeAttribute("aria-busy");
    slot.innerHTML = `<p class="flag shu long" id="enrichProblem">${escapeHtml(message)}</p>`;
  };
  const now = deps.now ?? (() => new Date().toISOString());
  void (async () => {
    if (!isEnrichKind(deps.kind)) return fail("この種類の資料は、本文から読み直せません");
    const kind = deps.kind;
    const settings = await deps.settings;
    const usable = new Set<CloudProviderId>();
    for (const provider of CLOUD_PROVIDERS) if ((await deps.vault.get(provider.secret)) !== undefined) usable.add(provider.id);
    const { assignments, defaultChoice } = readAiChoices(settings);
    let choice = decideFeatureAI("extract", assignments, defaultChoice, (id) => usable.has(id)).choice;
    let provider = choice ? CLOUD_PROVIDERS.find((candidate) => candidate.id === choice!.provider) : undefined;
    let base: Omit<PrepareEnrichInput, "notes">;
    let name: string;
    let excerptCount: number;
    try {
      const [work, layout] = await Promise.all([scanWorkFolder(deps.store, deps.root), readWorkLayout(deps.store, deps.root)]);
      const undecided = new Set(await (deps.undecidedConflicts?.() ?? Promise.resolve<readonly string[]>([])).catch((): readonly string[] => []));
      base = { store: deps.store, work, settingsDir: layout.settings, memoMarkers: layout.memoMarkers, kind, id: deps.id, undecidedConflicts: undecided };
      const material = await prepareEnrich({ ...base, notes: "" });
      name = material.target.record.name;
      excerptCount = material.excerpts.length;
    } catch (error) {
      return fail(error instanceof Error ? error.message : String(error));
    }
    if (!deps.stillHere()) return;
    const title = screen.querySelector<HTMLElement>(".appbar-title");
    if (title) title.textContent = `本文から読み直す：${name}`;

    const showEstimate = () => {
      const priceLine = choice && provider ? paidUsageNotice(provider.displayName, choice.model, { sends: "", calls: 1 }).lines[2]?.replace(/^料金[:：]\s*/, "") : undefined;
      const problem = excerptCount === 0 ? `本文に「${name}」の出る場面が見つかりません` : !choice || !provider ? "読み直しに使う AI がまだありません" : undefined;
      slot.removeAttribute("aria-busy");
      slot.innerHTML =
        `<label class="enrich-notes-label" for="enrichNotes">留意点（空でもかまいません）</label>` +
        `<textarea id="enrichNotes" rows="3" placeholder="${escapeHtml(ENRICH_NOTES_EXAMPLE)}"></textarea>` +
        `<dl class="estimate">` +
        `<div class="estimate-row"><dt>本文</dt><dd>名前の出る場面 ${excerptCount}か所</dd></div>` +
        (usable.size > 0
          ? `<div class="estimate-row"><dt>AI</dt><dd><button type="button" class="estimate-switch" id="enrichAi">${escapeHtml(choice ? describeChoice(choice) : "まだ選んでいません")}</button></dd></div>`
          : `<div class="estimate-row"><dt>AI</dt><dd>${escapeHtml(choice ? describeChoice(choice) : "まだ選んでいません")}</dd></div>`) +
        `<div class="estimate-row"><dt>料金</dt><dd>${escapeHtml(priceLine ?? "—")}</dd></div></dl>` +
        (problem
          ? `<p class="flag shu long" id="enrichProblem">${escapeHtml(problem)}</p>` + (choice ? "" : `<div class="menu-items"><button class="menu-item built" data-screen="ai">AI の設定</button></div>`)
          : `<div class="draft-actions"><button class="primary" id="enrichRun">読み直す</button></div>`) +
        `<p class="sync-result" id="enrichProgress" role="status"></p><div id="enrichAfter"></div>`;
      slot.querySelector<HTMLButtonElement>("#enrichAi")?.addEventListener("click", () => {
        void chooseAiForRun(deps.vault, deps.toast).then((next) => {
          if (!next || !deps.stillHere()) return;
          choice = next;
          provider = CLOUD_PROVIDERS.find((candidate) => candidate.id === next.provider);
          showEstimate();
        });
      });
      const run = slot.querySelector<HTMLButtonElement>("#enrichRun");
      if (!run || !choice || !provider) return;
      const chosen = choice;
      const chosenProvider = provider;
      run.addEventListener("click", () => void runOnce(run, chosen, chosenProvider));
    };

    const runOnce = async (run: HTMLButtonElement, chosen: NonNullable<typeof choice>, chosenProvider: NonNullable<typeof provider>) => {
      const notes = slot.querySelector<HTMLTextAreaElement>("#enrichNotes")?.value ?? "";
      const progress = slot.querySelector<HTMLElement>("#enrichProgress")!;
      const after = slot.querySelector<HTMLElement>("#enrichAfter")!;
      let material;
      try {
        // 留意点で頼みの文が変わるので、押したときに組み直す（材料は同じ読み方）
        material = await prepareEnrich({ ...base, notes });
      } catch (error) {
        progress.textContent = error instanceof Error ? error.message : String(error);
        return;
      }
      const ok = await confirmPaidUsage({
        actionLabel: "本文から読み直す",
        providerId: chosenProvider.id,
        providerName: chosenProvider.displayName,
        model: chosen.model,
        notice: { sends: `「${name}」の今の設定と、本文の名前の出る場面 約${material.prompt.length.toLocaleString("ja-JP")}字`, calls: 1 },
      });
      if (!ok || !deps.stillHere()) return;
      const key = await deps.vault.get(chosenProvider.secret);
      if (!key) return deps.toast("APIキーが見つかりません");
      run.disabled = true;
      slot.querySelector<HTMLTextAreaElement>("#enrichNotes")?.setAttribute("disabled", "");
      progress.textContent = "AI に見せています";
      let outcome: EnrichOutcome;
      try {
        const caller = typoCallerFor(chosenProvider.id, key, chosen.model);
        outcome = await whileWorking(deps.background ?? backgroundWork(), "本文から読み直す", 1, async (step) => {
          try {
            return await runEnrich(material, (request) => caller({ ...request, signal: abort.signal }), { signal: abort.signal });
          } finally {
            step(1);
          }
        });
      } catch (error) {
        if (abort.signal.aborted || !deps.stillHere()) return;
        run.disabled = false;
        slot.querySelector<HTMLTextAreaElement>("#enrichNotes")?.removeAttribute("disabled");
        progress.textContent = error instanceof Error ? error.message : String(error);
        return;
      }
      if (!deps.stillHere()) return;
      run.remove();
      progress.textContent = outcome.rows.length > 0 ? `案が${outcome.rows.length}つあります。選んで［選んだ項目を反映］を押すと、資料に書きます` : "";
      after.innerHTML = renderEnrichOutcome(outcome);
      after.querySelector<HTMLButtonElement>("#enrichDiscard")?.addEventListener("click", () => deps.done());
      let items = outcome.misattributed;
      // はじいた記述を行き先へ入れる（押した1件だけ。案の反映とは別に書く。本体と同じ）
      after.querySelector<HTMLElement>(".enrich-misattributed")?.addEventListener("click", (event) => {
        const button = (event.target as HTMLElement).closest<HTMLButtonElement>(".enrich-place");
        if (!button) return;
        const index = Number(button.dataset.index);
        const entry = items[index];
        if (!entry) return;
        button.disabled = true;
        void (async () => {
          let result;
          try {
            result = await placeMisattributed(deps.store, base.settingsDir, entry, now(), deps.beforeWrite);
          } catch (error) {
            result = { ok: false as const, notice: error instanceof Error ? error.message : String(error) };
          }
          if (!deps.stillHere()) return;
          if (!result.ok) {
            button.disabled = false;
            deps.toast(result.notice);
            return;
          }
          const line = document.createElement("p");
          line.className = "enrich-placed";
          line.setAttribute("role", "status");
          line.textContent = result.notice;
          button.replaceWith(line);
          // 残りの行き先を引き直す（新しく起こした人物へ、同じ相手の2件目が入るように）
          items = await refreshDestinations(deps.store, base.settingsDir, items).catch(() => items);
          if (!deps.stillHere()) return;
          after.querySelectorAll<HTMLButtonElement>(".enrich-place").forEach((other) => {
            const next = items[Number(other.dataset.index)]?.destination;
            if (next) other.textContent = next.kind === "existing" ? `「${next.name}」へ入れる` : `「${next.name}」を新しく起こして入れる`;
          });
        })();
      });
      const apply = after.querySelector<HTMLButtonElement>("#enrichApply");
      apply?.addEventListener("click", () => {
        void (async () => {
          const values = chosenValues(after);
          if (Object.keys(values).length === 0) return deps.toast("反映する項目を選んでください");
          apply.disabled = true;
          const at = now();
          const updated = applyEnrichRows(material.target, values, material.characters, at);
          await deps.beforeWrite?.(material.target.path).catch(() => undefined);
          const saved = await saveRecord(deps.store, material.target, updated, at);
          if (!deps.stillHere()) return;
          if (!saved.ok) {
            apply.disabled = false;
            progress.textContent = saveRecordFailureText(saved);
            return;
          }
          deps.toast(`${Object.keys(values).length}項目を反映しました`);
          deps.done();
        })();
      });
    };

    showEstimate();
  })();
  return () => abort.abort();
}
