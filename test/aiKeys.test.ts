import { describe, expect, test } from "vitest";
import { CLOUD_PROVIDERS, checkApiKey, keyCheckText, modelListRequest, modelNames, saveApiKey, type CheckFetch } from "../src/platform/aiKeys";
import { MemorySecretVault } from "../src/platform/secretVault";
import { keyPrompt, renderKeyRows } from "../src/app/aiScreen";

/** クラウドの AI の鍵（`src/platform/aiKeys.ts`。引継ぎ書 71章）。鍵は作り物、相手は偽物 */

const FAKE = "sk-tukurimono-0000";

describe("鍵の置き場と形", () => {
  test("置き場の名前は本体の資格情報ストアと同じ。前後の空白は落とし、空・途中の空白は断る（本体の文言）", async () => {
    expect(CLOUD_PROVIDERS.map((p) => p.secret)).toEqual(["novelai.claude.apiKey", "novelai.openai.apiKey", "novelai.gemini.apiKey", "novelai.sakura.apiKey"]);
    const vault = new MemorySecretVault();
    const claude = CLOUD_PROVIDERS[0]!;
    expect(await saveApiKey(vault, claude, `  ${FAKE}\n`)).toEqual({ ok: true });
    expect(await vault.get("novelai.claude.apiKey")).toBe(FAKE);
    expect(await saveApiKey(vault, claude, "   ")).toEqual({ ok: false, problem: "APIキーを入力してください。" });
    expect(await saveApiKey(vault, claude, "sk-a b")).toEqual({ ok: false, problem: "APIキーの途中に空白や改行が混ざっています。貼り付け直してください。" });
  });
});

describe("鍵が使えるか確かめる", () => {
  test("どの相手にも、鍵は頭にだけ置き、URL に書かない", () => {
    for (const provider of CLOUD_PROVIDERS) {
      const { url, headers } = modelListRequest(provider.id, FAKE);
      expect(url).not.toContain(FAKE);
      expect(Object.values(headers).join(" ")).toContain(FAKE);
    }
    expect(modelListRequest("gemini", FAKE).headers["x-goog-api-key"]).toBe(FAKE);
  });

  test("モデルの名前を取り出す（Gemini は models/ を外す）。状態の番号で分ける", async () => {
    expect(modelNames("claude", { data: [{ id: "claude-sonnet" }, { id: "claude-haiku" }] })).toEqual(["claude-sonnet", "claude-haiku"]);
    expect(modelNames("gemini", { models: [{ name: "models/gemini-pro" }] })).toEqual(["gemini-pro"]);
    const answer = (status: number, body: unknown = {}): CheckFetch => async () => new Response(JSON.stringify(body), { status });
    expect(await checkApiKey("openai", FAKE, answer(200, { data: [{ id: "gpt" }] }))).toEqual({ kind: "ok", models: ["gpt"] });
    expect(await checkApiKey("claude", FAKE, answer(401))).toEqual({ kind: "bad_key" });
    expect(await checkApiKey("gemini", FAKE, answer(400))).toEqual({ kind: "bad_key" });
    expect(await checkApiKey("sakura", FAKE, answer(429))).toEqual({ kind: "rate_limited" });
    expect(await checkApiKey("sakura", FAKE, answer(503))).toEqual({ kind: "server" });
    expect(
      await checkApiKey("openai", FAKE, async () => {
        throw new TypeError("Failed to fetch");
      })
    ).toEqual({ kind: "offline" });
    expect(keyCheckText({ kind: "ok", models: ["a", "b"] })).toBe("使えます（モデル 2個）");
    expect(keyCheckText({ kind: "bad_key" })).toBe("APIキーが違うか、使えないキーです");
  });
});

test("画面：登録していなければ［登録］、登録してあれば［確かめる］［入力し直す］［消す］。鍵の字は出さない。訊く窓は本体の題", () => {
  const [claude, openai] = CLOUD_PROVIDERS;
  const html = renderKeyRows([
    { provider: claude!, registered: true, result: { text: "使えます", ok: true } },
    { provider: openai!, registered: false },
  ]);
  expect(html).toContain(`data-ai-check="claude"`);
  expect(html).toContain(`data-ai-remove="claude"`);
  expect(html).toContain(`<button data-ai-set="openai">登録</button>`);
  expect(html).not.toContain(FAKE);
  expect(keyPrompt(claude!).message).toBe("ClaudeのAPIキーを入力してください");
  expect(keyPrompt(CLOUD_PROVIDERS[3]!).message).toBe("さくらのAI EngineのAPIキーを入力してください");
});
