import { cloudFetch } from "./fetchTimeouts";
import type { SecretVault } from "./secretVault";
import { validateApiKeyFormat } from "../shared";

/**
 * **クラウドの AI の鍵（API キー）**（設計書 8章「鍵は Android Keystore で暗号化して保管。全作品で共通」・
 * 共通設計書 2.9。母艦の指示 2026-11-16 の B。引継ぎ書 71章）。
 *
 * - 置き場は端末の鍵の置き場（`SecretVault`。58章）。名前は本体の資格情報ストアと同じ（`novelai.claude.apiKey` など）
 * - 形の確かめは本体の `validateApiKeyFormat` と同じ（空・途中の空白や改行だけを断る。接頭辞では見ない）。前後の空白は落とす
 * - **鍵は URL に書かない**。どの相手にも頭（ヘッダー）で渡す（Gemini も `?key=` でなく `x-goog-api-key`）
 * - 鍵が使えるかは、モデルの一覧を訊いて確かめる（本体と同じ「接続テストで確かめる」）。本文は送らない・料金はかからない
 * - 道は AI への通信と同じ `cloudFetch`（CORS を許す相手は WebView の fetch、さくらは端末の側の通信）
 */

export type CloudProviderId = "claude" | "openai" | "gemini" | "sakura";

export interface CloudProvider {
  id: CloudProviderId;
  /** 本体の表示名（「Claude（クラウド・有料）」） */
  displayName: string;
  /** 鍵を訊くときの名前（本体の apiKeyHelp の題「ClaudeのAPIキーを入力してください」） */
  keyName: string;
  /** 端末の鍵の置き場の名前（本体の資格情報ストアと同じ） */
  secret: string;
}

export const CLOUD_PROVIDERS: readonly CloudProvider[] = [
  { id: "claude", displayName: "Claude（クラウド・有料）", keyName: "Claude", secret: "novelai.claude.apiKey" },
  { id: "openai", displayName: "ChatGPT（クラウド・有料）", keyName: "ChatGPT", secret: "novelai.openai.apiKey" },
  { id: "gemini", displayName: "Gemini（クラウド・無料枠あり）", keyName: "Gemini", secret: "novelai.gemini.apiKey" },
  { id: "sakura", displayName: "さくらのAI（クラウド・無料枠あり）", keyName: "さくらのAI Engine", secret: "novelai.sakura.apiKey" },
];

/** 本体の `validateApiKeyFormat`（ai/types.ts。vscode に頼らない）をそのまま使う */
export { validateApiKeyFormat };

export async function saveApiKey(vault: SecretVault, provider: CloudProvider, raw: string): Promise<{ ok: true } | { ok: false; problem: string }> {
  const problem = validateApiKeyFormat(raw);
  if (problem) return { ok: false, problem };
  await vault.set(provider.secret, raw.trim());
  return { ok: true };
}

export type KeyCheck =
  | { kind: "ok"; models: string[] }
  /** 鍵が違う・権限が無い（401・403） */
  | { kind: "bad_key" }
  | { kind: "offline" }
  | { kind: "rate_limited" }
  | { kind: "server" }
  | { kind: "unknown"; status?: number };

/** モデルの一覧を訊く口（相手ごとの道と頭）。鍵は頭にだけ置く */
export function modelListRequest(id: CloudProviderId, key: string): { url: string; headers: Record<string, string> } {
  switch (id) {
    case "claude":
      return {
        url: "https://api.anthropic.com/v1/models?limit=100",
        // WebView から直に呼ぶときに Anthropic が求める印（本体も process の無い所では付ける。fetchTimeouts.ts）
        headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
      };
    case "openai":
      return { url: "https://api.openai.com/v1/models", headers: { Authorization: `Bearer ${key}` } };
    case "gemini":
      return { url: "https://generativelanguage.googleapis.com/v1beta/models?pageSize=200", headers: { "x-goog-api-key": key } };
    case "sakura":
      return { url: "https://api.ai.sakura.ad.jp/v1/models", headers: { Authorization: `Bearer ${key}` } };
  }
}

/** 答えからモデルの名前を取り出す（Gemini は `models/` を外す） */
export function modelNames(id: CloudProviderId, data: unknown): string[] {
  const record = data !== null && typeof data === "object" ? (data as Record<string, unknown>) : {};
  const list = id === "gemini" ? record.models : record.data;
  if (!Array.isArray(list)) return [];
  return list
    .map((item) => {
      const value = (item as Record<string, unknown>)?.[id === "gemini" ? "name" : "id"];
      return typeof value === "string" ? value.replace(/^models\//, "") : "";
    })
    .filter((name) => name !== "");
}

export type CheckFetch = (url: string, init: RequestInit, timeoutMs: number) => Promise<Response>;

/** 鍵が使えるか確かめる（モデルの一覧を訊く）。本文は送らない */
export async function checkApiKey(id: CloudProviderId, key: string, fetcher: CheckFetch = cloudFetch): Promise<KeyCheck> {
  const { url, headers } = modelListRequest(id, key);
  let response: Response;
  try {
    response = await fetcher(url, { method: "GET", headers }, 20_000);
  } catch {
    return { kind: "offline" };
  }
  if (response.status === 401 || response.status === 403) return { kind: "bad_key" };
  // Gemini は鍵が違うとき 400（API_KEY_INVALID）を返す
  if (id === "gemini" && response.status === 400) return { kind: "bad_key" };
  if (response.status === 429) return { kind: "rate_limited" };
  if (response.status >= 500) return { kind: "server" };
  if (!response.ok) return { kind: "unknown", status: response.status };
  try {
    return { kind: "ok", models: modelNames(id, await response.json()) };
  } catch {
    return { kind: "unknown", status: response.status };
  }
}

/** 確かめた結果の1行 */
export function keyCheckText(check: KeyCheck): string {
  switch (check.kind) {
    case "ok":
      return check.models.length > 0 ? `使えます（モデル ${check.models.length}個）` : "使えます";
    case "bad_key":
      return "APIキーが違うか、使えないキーです";
    case "offline":
      return "つながりません";
    case "rate_limited":
      return "回数の上限に当たりました。しばらく待ってから確かめてください";
    case "server":
      return "相手の側で不具合が起きています";
    case "unknown":
      return "確かめられませんでした";
  }
}
