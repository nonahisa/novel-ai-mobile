import { escapeHtml } from "./menuScreen";
import type { CloudProvider } from "../platform/aiKeys";

/**
 * **設定 → AI**（［ほか］→ 設定 → AI。`#/ai`。設計書 7章【案】「設定（H）→ AI：使う AI の登録・鍵・機能ごとの割り当て」。
 * 引継ぎ書 71章）。いまは鍵の登録まで（割り当ては次の段）。
 *
 * - クラウドの AI ごとに1行：名前（本体の表示名）・「登録済み」の印・押す所
 * - 登録していなければ［登録］。登録してあれば［確かめる］（モデルの一覧を訊く。本文は送らない）・［入力し直す］・［消す］
 * - 鍵の字は画面に出さない
 */

export type KeyRow = { provider: CloudProvider; registered: boolean; result?: { text: string; ok: boolean } };

export function renderKeyRows(rows: readonly KeyRow[]): string {
  return rows
    .map(({ provider, registered, result }) => {
      const flag = registered ? `<span class="flag ok">登録済み</span>` : "";
      const line = result ? `<p class="ai-result${result.ok ? "" : " warn"}" role="status">${escapeHtml(result.text)}</p>` : "";
      const buttons = registered
        ? `<button data-ai-check="${provider.id}">確かめる</button><button data-ai-set="${provider.id}">入力し直す</button><button data-ai-remove="${provider.id}">消す</button>`
        : `<button data-ai-set="${provider.id}">登録</button>`;
      return (
        `<div class="ai-row" data-provider="${provider.id}">` +
        `<div class="ai-head"><span class="name">${escapeHtml(provider.displayName)}</span>${flag}</div>` +
        `<div class="ai-actions">${buttons}</div>${line}</div>`
      );
    })
    .join("");
}

export function renderAiScreen(rows: readonly KeyRow[]): string {
  return `<section class="menu-section"><h2>APIキー</h2><div id="aiKeys">${renderKeyRows(rows)}</div></section>`;
}

/** 鍵を訊く窓の字（本体の apiKeyHelp の題と貼り付けの案内。保存先だけ端末の言い方） */
export function keyPrompt(provider: CloudProvider): { message: string; placeholder: string; note: string } {
  return {
    message: `${provider.keyName}のAPIキーを入力してください`,
    placeholder: "APIキーを貼り付けてください",
    note: "入力内容は端末の鍵の置き場（Keystore／Keychain）に保存され、ほかの所には書き込まれません。",
  };
}

export function removeQuestion(provider: CloudProvider): string {
  return `この端末から${provider.keyName}のAPIキーを消します。\nもう一度使うには、入力し直します`;
}
