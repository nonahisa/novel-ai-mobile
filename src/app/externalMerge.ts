import { sha256Text } from "novel-ai-assistant/src/core/hash";
import {
  assembleDriveMerge,
  mergeDriveTexts,
  verifyDriveMerge,
  type DriveMergeCandidate,
  type DriveTextMerge,
} from "novel-ai-assistant/src/core/driveTextMerge";
import { escapeHtml } from "./menuScreen";

/**
 * **「外で変わりました」のときの合わせ方**（作者の答え 2026-11-16「重ならない部分は反映。それ以外は画面上に表示して
 * 選ばせてください」・パネルで形を確かめた。引継ぎ書 76章）。
 *
 * - 比べる3つ：最後に保存した本文（元）・いまの書きかけ（こちら）・入れ替わった本文（あちら）
 * - 合わせ方は本体の `core/driveTextMerge.ts`（Google ドライブの食い違いのために作られ、モバイル版へ持っていく前提で
 *   vscode に頼らない）をそのまま使う：段落（行）ごとに比べ、片方だけが変えた所は自動で当て、両方が違うように変えた所
 *   （重なる・接する所。git と同じ）だけを作者に選ばせる。**機械は新しい文を作らない**（当てるのはどちらかの行をそのまま写したもの）
 * - 書く前に本体の `verifyDriveMerge` で確かめる。合わせられない（競合の印・改行の形が混ざっている・違いが多すぎる）ときは
 *   今までどおり保存を止めたまま（書きかけは控えに残る）
 * - 選ぶ画面の字はこの部品が作る（DOM の無い試験で中身を確かめる）。書くのと開き直すのは `episodeScreen.ts`
 */

export interface ExternalMergeInput {
  /** 最後に保存した本文（開いたとき・保存が済んだときの字） */
  base: string;
  /** いまの書きかけ */
  ours: string;
  /** 入れ替わった本文（いまファイルにある字） */
  theirs: string;
}

export interface ExternalMergePlan {
  kind: "merge";
  merge: DriveTextMerge;
  candidates: DriveMergeCandidate[];
  oursId: string;
  theirsId: string;
}

export type ExternalMergeResult = ExternalMergePlan | { kind: "unmergeable"; reason: string };

const lf = (text: string) => text.replace(/\r\n?/g, "\n");

/** 合わせ方を組む。候補の印は中身のハッシュ（同じ字なら1つになる） */
export function planExternalMerge(input: ExternalMergeInput): ExternalMergeResult {
  const ours = { id: sha256Text(lf(input.ours)), text: lf(input.ours) };
  const theirs = { id: sha256Text(lf(input.theirs)), text: lf(input.theirs) };
  // 同じ字なら合わせるまでもない（2つ無いと本体の部品は合わせない）
  const candidates = ours.id === theirs.id ? [ours, { ...ours, id: `${ours.id}-same` }] : [ours, theirs];
  const merge = mergeDriveTexts({ base: lf(input.base), candidates });
  if (merge.kind !== "merge") return merge;
  return { kind: "merge", merge, candidates, oursId: ours.id, theirsId: theirs.id };
}

/** 重なった所ごとの「こちら」「あちら」の文（どちらかが無ければ undefined。消したのなら空の行の並び） */
export interface RegionChoice {
  ours?: { option: number; lines: string[] };
  theirs?: { option: number; lines: string[] };
}

export function regionChoices(plan: ExternalMergePlan): RegionChoice[] {
  return plan.merge.regions.map((region) => {
    const choice: RegionChoice = {};
    region.options.forEach((option, index) => {
      if (option.candidates.includes(plan.oursId)) choice.ours = { option: index, lines: option.lines };
      if (option.candidates.includes(plan.theirsId)) choice.theirs = { option: index, lines: option.lines };
    });
    return choice;
  });
}

/** 選んだ答え（重なった所ごとの options の番号）で文を組み、書く前に確かめる。だめなら理由 */
export function finishMerge(plan: ExternalMergePlan, picks: readonly number[], base: string): { ok: true; text: string } | { ok: false; reason: string } {
  const checked = verifyDriveMerge(plan.merge, picks, { base: lf(base), candidates: plan.candidates });
  if (checked !== true) return { ok: false, reason: checked };
  const text = assembleDriveMerge(plan.merge, picks);
  return text === undefined ? { ok: false, reason: "選びが足りません" } : { ok: true, text };
}

/** 重なった所を選ぶ画面の中身。`picked` は重なった所ごとに選んだもの */
export function renderMergeChoices(choices: readonly RegionChoice[], picked: readonly ("ours" | "theirs" | undefined)[]): string {
  const side = (index: number, which: "ours" | "theirs", label: string, lines: string[] | undefined) => {
    if (!lines) return "";
    const body = lines.length === 0 ? `<span class="flag warn">消した</span>` : lines.map((line) => `<span class="cf-line">${escapeHtml(line) || "&#8203;"}</span>`).join("");
    return `<button class="merge-side" data-merge-region="${index}" data-merge-pick="${which}" aria-pressed="${picked[index] === which}"><span class="merge-label">${label}</span><span class="merge-text">${body}</span></button>`;
  };
  const rows = choices
    .map(
      (choice, index) =>
        `<section class="merge-region"><h2 class="chap">${index + 1}</h2>${side(index, "ours", "こちら", choice.ours?.lines)}${side(index, "theirs", "あちら", choice.theirs?.lines)}</section>`
    )
    .join("");
  const ready = choices.length > 0 && picked.length === choices.length && picked.every((pick) => pick !== undefined);
  return (
    `<p class="merge-title">${escapeHtml(`外の変更と、書きかけが重なった所：${choices.length}`)}</p>${rows}` +
    `<div class="dialog-actions merge-actions"><button type="button" data-merge-cancel>やめる</button><button type="button" class="primary" data-merge-save${ready ? "" : " disabled"}>合わせて保存</button></div>`
  );
}

/**
 * 重なった所を選ぶ画面（原稿の上に全面で重ねる）。選び終えて［合わせて保存］なら選んだものを、［やめる］・端末の［戻る］
 * （`data-answer="no"`）なら undefined を返す
 */
export function chooseMergeRegions(choices: readonly RegionChoice[]): Promise<("ours" | "theirs")[] | undefined> {
  return new Promise((resolve) => {
    const picked: ("ours" | "theirs" | undefined)[] = choices.map(() => undefined);
    const backdrop = document.createElement("div");
    backdrop.className = "dialog-backdrop merge-backdrop";
    const sheet = document.createElement("div");
    sheet.className = "dialog merge-sheet";
    sheet.setAttribute("role", "dialog");
    sheet.setAttribute("aria-modal", "true");
    backdrop.appendChild(sheet);
    const paint = () => {
      sheet.innerHTML = renderMergeChoices(choices, picked);
      sheet.querySelector<HTMLElement>("[data-merge-cancel]")!.dataset.answer = "no";
    };
    const close = (value: ("ours" | "theirs")[] | undefined) => {
      backdrop.remove();
      resolve(value);
    };
    sheet.addEventListener("click", (event) => {
      const target = (event.target as HTMLElement).closest<HTMLElement>("[data-merge-pick],[data-merge-cancel],[data-merge-save]");
      if (!target) return;
      if (target.dataset.mergePick) {
        picked[Number(target.dataset.mergeRegion)] = target.dataset.mergePick === "ours" ? "ours" : "theirs";
        const scroll = sheet.scrollTop;
        paint();
        sheet.scrollTop = scroll;
        return;
      }
      if (target.hasAttribute("data-merge-cancel")) return close(undefined);
      if (picked.every((pick) => pick !== undefined)) close(picked as ("ours" | "theirs")[]);
    });
    paint();
    document.body.appendChild(backdrop);
    sheet.querySelector<HTMLElement>("[data-merge-cancel]")?.focus({ preventScroll: true });
  });
}
