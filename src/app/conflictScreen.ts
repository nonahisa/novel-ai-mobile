import { escapeHtml } from "./menuScreen";
import type { ConflictChoice, ConflictMaterial } from "../platform/syncConflict";
import type { ApplyChoiceResult } from "../platform/syncConflict";

/**
 * **競合した話を選ぶ画面**（設計書 6章「話ごとに［こちら］［あちら］［両方残す］を選ぶ」。引継ぎ書 60章）。
 * `#/conflict/<作品>/<リポジトリの中の道>`。同期の画面（G）の「競合」の行から開く。
 *
 * - 上の［こちら｜あちら］で、どちらの文を見るかを切り替える（狭い画面に2つは並ばない）。
 *   もう片方に無い行に印を付ける（どこが違うかが分かる）
 * - 下に選ぶボタン。［あちらにする］は、こちらの文が消えるので確かめてから（消える・上書きは確かめる）。
 *   ［両方残す］は両方に原稿があって JSON でないときだけ（本体と同じ）
 * - 文字列で作るので、DOM の無いテストでも中身を確かめられる
 */

export type ConflictView = "ours" | "theirs";

export const CHOICE_LABELS: Readonly<Record<ConflictChoice, string>> = {
  ours: "こちらを残す",
  theirs: "あちらにする",
  both: "両方残す",
};

/** ［あちらにする］の確かめ。あちらが消した話なら、この端末からも消す */
export function theirsQuestion(material: Pick<ConflictMaterial, "theirs" | "ours">): { message: string; yes: string } {
  if (!material.theirs.exists) return { message: "あちらでは、この話を消しました。\nこの端末からも消します", yes: "消す" };
  if (!material.ours.exists) return { message: "この端末で消した話を、あちらの文で戻します", yes: "あちらにする" };
  return { message: "こちらの文を、あちらの文に置き換えます。\nこちらの文は消えます", yes: "あちらにする" };
}

/** 選べなかったときの1行 */
export function applyFailureText(result: Extract<ApplyChoiceResult, { ok: false }>): string {
  switch (result.reason) {
    case "stale":
      return "GitHub の版が変わりました。もう一度［取ってくる］を押してください";
    case "modified_externally":
      return "この話がこの端末で書き換わりました。もう一度選んでください";
    case "encoding_error":
      return result.detail ?? "元の文字コードで書けない字があります";
    case "not_offered":
      return "この話では選べません";
    default:
      return "書けませんでした。原稿は変えていません";
  }
}

function linesHtml(text: string, other: string): string {
  const others = new Set(other.split("\n"));
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines.map((line) => `<span class="cf-line${others.has(line) ? "" : " cf-diff"}">${escapeHtml(line) || "&#8203;"}</span>`).join("");
}

export function renderConflictView(material: ConflictMaterial, view: ConflictView): string {
  const tab = (side: ConflictView, label: string) =>
    `<button data-cf-view="${side}" aria-pressed="${view === side}">${label}</button>`;
  const shown = view === "ours" ? material.ours : material.theirs;
  const other = view === "ours" ? material.theirs : material.ours;
  const body = shown.exists
    ? `<div class="cf-text" data-side="${view}">${linesHtml(shown.text, other.text)}</div>`
    : `<p class="sync-state"><span class="flag warn">消した</span></p>`;
  const choices = material.choices
    .map((choice) => `<button data-cf-choice="${choice}"${choice === "theirs" ? ` class="danger"` : ""}>${CHOICE_LABELS[choice]}</button>`)
    .join("");
  return `<div class="seg cf-tabs">${tab("ours", "こちら")}${tab("theirs", "あちら")}</div>${body}<div class="cf-choices">${choices}</div>`;
}
