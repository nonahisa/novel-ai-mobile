import { escapeHtml } from "./menuScreen";
import { isLocalProviderId, paidUsageNotice, type PaidUsageNoticeOptions } from "../shared";

/**
 * **有料の AI へ送る前の確認の窓**（共通設計書 4.4・本体の設計書 7.1.1。母艦 2026-11-16「クラウドへ本文を送る所は
 * 作者の同意の画面を通す形で、本体の設定の文言と揃える」。引継ぎ書 72章）。
 *
 * - 文言は本体の `paidUsageNotice`（`core/paidUsageNotice.ts`）をそのまま使う：本文の3行（どこへ・何を・いくら）と、
 *   ［詳しく］で開く行（使うモデル・トークンの断り・金額の断り）。題は「〈操作〉を実行しますか」、ボタンは「実行」
 * - **手元の AI（Ollama・LM Studio）では出さない**（本体の `isLocalProviderId`。料金がかからない・外へ出ない）
 * - いいえ側は［やめる］。背景を押す・端末の［戻る］キー（`data-answer="no"`）もやめる。焦点はやめる側
 * - 「以降は訊かない」は、呼ぶ側が覚えさせるときだけ（いまは無い）
 * - まだ AI を走らせる画面は無い。走らせる直前の見積もり（F）を作るときに、この窓を通す
 */

export interface PaidConfirmRequest {
  /** 操作の名前（「誤字脱字」） */
  actionLabel: string;
  /** 本体の ProviderId（"claude" など） */
  providerId: string;
  /** 本体の表示名（「Claude（クラウド・有料）」） */
  providerName: string;
  model: string;
  notice: PaidUsageNoticeOptions;
}

/** 窓の中身（DOM の無い試験で中身を確かめる）。手元の AI なら undefined（窓を出さない） */
export function paidConfirmHtml(request: PaidConfirmRequest): string | undefined {
  if (isLocalProviderId(request.providerId)) return undefined;
  const notice = paidUsageNotice(request.providerName, request.model, request.notice);
  return (
    `<p class="dialog-title">${escapeHtml(`${request.actionLabel}を実行しますか`)}</p>` +
    `<ul class="paid-lines">${notice.lines.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ul>` +
    `<details class="paid-more"><summary>詳しく</summary><ul>${notice.more.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ul></details>`
  );
}

/** 確かめる。実行なら true。手元の AI なら訊かずに true */
export function confirmPaidUsage(request: PaidConfirmRequest): Promise<boolean> {
  const body = paidConfirmHtml(request);
  if (body === undefined) return Promise.resolve(true);
  return new Promise((resolve) => {
    const backdrop = document.createElement("div");
    backdrop.className = "dialog-backdrop";
    backdrop.innerHTML =
      `<div class="dialog paid-confirm" role="alertdialog" aria-modal="true">${body}` +
      `<div class="dialog-actions"><button type="button" data-answer="no">やめる</button><button type="button" class="primary" data-answer="yes">実行</button></div></div>`;
    const answer = (value: boolean) => {
      backdrop.remove();
      resolve(value);
    };
    backdrop.querySelector<HTMLButtonElement>('[data-answer="yes"]')!.addEventListener("click", () => answer(true));
    const no = backdrop.querySelector<HTMLButtonElement>('[data-answer="no"]')!;
    no.addEventListener("click", () => answer(false));
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) answer(false);
    });
    document.body.appendChild(backdrop);
    no.focus({ preventScroll: true });
  });
}
