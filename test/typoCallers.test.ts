import { describe, expect, test } from "vitest";
import { AIError, TYPO_CHECK_TEMPERATURE, type JsonRequest } from "../src/shared";
import { chatText, geminiCaller, geminiText, openAICaller, sakuraCaller, typoCallerFor } from "../src/platform/typoCallers";

/**
 * 誤字脱字を Claude 以外の AI にも頼む口（段2。2026-11-18）。本物の AI は呼ばない（作者の鍵とお金）。
 * 頼みの形・鍵の置き場・断られた指定の外し方・答えの読み方を、偽の通信で見張る
 */
const SCHEMA = { type: "object", properties: { issues: { type: "array", items: { type: "string" } } }, required: ["issues"] };
const REQUEST = { system: "頼みの決まり", user: "1: 本文", schema: SCHEMA };

/** 答えを順に返し、受けた頼みを控える偽の通信。答えが Error なら投げる */
function fakeFetch(answers: unknown[]) {
  const seen: JsonRequest[] = [];
  const fetcher = async <T,>(request: JsonRequest): Promise<T> => {
    seen.push(JSON.parse(JSON.stringify(request)) as JsonRequest);
    const next = answers.shift();
    if (next instanceof Error) throw next;
    return next as T;
  };
  return { fetcher, seen };
}
const chatOk = (text: string) => ({ choices: [{ message: { content: text }, finish_reason: "stop" }] });
const http400 = (detail: string) => new AIError("HTTP 400", "bad_response", detail);

describe("ChatGPT", () => {
  test("鍵は頭書きだけ。温度・スキーマ（strict）・system と user を送り、答えの字を返す", async () => {
    const { fetcher, seen } = fakeFetch([chatOk('{"issues":[]}')]);
    expect(await openAICaller("sk-test", "gpt-test", fetcher)(REQUEST)).toBe('{"issues":[]}');
    const sent = seen[0]!;
    expect(sent.url).toBe("https://api.openai.com/v1/chat/completions");
    expect(sent.url).not.toContain("sk-test");
    expect(sent.headers).toEqual({ Authorization: "Bearer sk-test" });
    const body = sent.body as Record<string, any>;
    expect(body.temperature).toBe(TYPO_CHECK_TEMPERATURE);
    expect(body.response_format.json_schema.strict).toBe(true);
    expect(body.messages).toEqual([{ role: "system", content: "頼みの決まり" }, { role: "user", content: "1: 本文" }]);
  });
  test("温度を断られたら外し、max_completion_tokens を断られたら max_tokens に言い換えて出し直す", async () => {
    const { fetcher, seen } = fakeFetch([http400("'temperature' is not supported with this model"), http400("Unsupported parameter: 'max_completion_tokens'"), chatOk("{}")]);
    await openAICaller("k", "m", fetcher)(REQUEST);
    expect(seen).toHaveLength(3);
    const last = seen[2]!.body as Record<string, unknown>;
    expect(last.temperature).toBeUndefined();
    expect(last.max_tokens).toBe(16000);
    expect(last.max_completion_tokens).toBeUndefined();
  });
  test("ほかの失敗（鍵など）は出し直さずに投げる", async () => {
    const { fetcher, seen } = fakeFetch([new AIError("鍵が違います", "authentication_failed")]);
    await expect(openAICaller("k", "m", fetcher)(REQUEST)).rejects.toThrow("鍵が違います");
    expect(seen).toHaveLength(1);
  });
});

describe("さくらのAI", () => {
  test("思考を止める指定を送る。400 ならその指定を外して出し直す", async () => {
    const { fetcher, seen } = fakeFetch([http400("Bad Request"), chatOk("{}")]);
    await sakuraCaller("k", "qwen", fetcher)(REQUEST);
    expect(seen[0]!.url).toBe("https://api.ai.sakura.ad.jp/v1/chat/completions");
    expect((seen[0]!.body as Record<string, unknown>).chat_template_kwargs).toEqual({ enable_thinking: false, thinking: false });
    expect((seen[1]!.body as Record<string, unknown>).chat_template_kwargs).toBeUndefined();
  });
  test("JSON の形の強制を断られたら外す", async () => {
    const { fetcher, seen } = fakeFetch([http400("response_format is not supported"), chatOk("{}")]);
    await sakuraCaller("k", "m", fetcher)(REQUEST);
    expect((seen[1]!.body as Record<string, unknown>).response_format).toBeUndefined();
    expect((seen[1]!.body as Record<string, unknown>).chat_template_kwargs).toBeDefined();
  });
});

describe("Gemini", () => {
  test("鍵は x-goog-api-key（URL に ?key= を付けない）。思考を止め、スキーマを付ける", async () => {
    const { fetcher, seen } = fakeFetch([{ candidates: [{ content: { parts: [{ text: "{}" }] }, finishReason: "STOP" }] }]);
    expect(await geminiCaller("g-key", "gemini-test", fetcher)(REQUEST)).toBe("{}");
    expect(seen[0]!.url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-test:generateContent");
    expect(seen[0]!.headers).toEqual({ "x-goog-api-key": "g-key" });
    const config = (seen[0]!.body as Record<string, any>).generationConfig;
    expect(config.thinkingConfig).toEqual({ thinkingBudget: 0 });
    expect(config.responseSchema).toBeDefined();
    expect(config.temperature).toBe(TYPO_CHECK_TEMPERATURE);
  });
  test("400 なら思考の指定 → スキーマの順に外す（JSON で返す指定は残す）", async () => {
    const bad = http400("Request contains an invalid argument. INVALID_ARGUMENT");
    const { fetcher, seen } = fakeFetch([bad, bad, { candidates: [{ content: { parts: [{ text: "{}" }] } }] }]);
    await geminiCaller("k", "m", fetcher)(REQUEST);
    const configs = seen.map((s) => (s.body as Record<string, any>).generationConfig);
    expect(configs[1].thinkingConfig).toBeUndefined();
    expect(configs[1].responseSchema).toBeDefined();
    expect(configs[2].responseSchema).toBeUndefined();
    expect(configs[2].responseMimeType).toBe("application/json");
  });
  test("止められた・切れた・空の答えは投げる。思考の部分は答えに入れない", () => {
    expect(() => geminiText({ promptFeedback: { blockReason: "SAFETY" } })).toThrow("受け付けませんでした");
    expect(() => geminiText({ candidates: [{ finishReason: "RECITATION" }] })).toThrow("引用");
    expect(() => geminiText({ candidates: [{ finishReason: "MAX_TOKENS", content: { parts: [{ text: "{" }] } }] })).toThrow("途中で切れました");
    expect(() => geminiText({ candidates: [{ content: { parts: [] } }] })).toThrow("空");
    expect(geminiText({ candidates: [{ content: { parts: [{ text: "考え", thought: true }, { text: "{}" }] } }] })).toBe("{}");
  });
});

describe("答えの読み方（OpenAI の形）", () => {
  test("断り・途中で切れた・空は投げる", () => {
    expect(() => chatText({ choices: [{ message: { refusal: "できません" } }] })).toThrow("断りました");
    expect(() => chatText({ choices: [{ message: { content: "{" }, finish_reason: "length" }] })).toThrow("途中で切れました");
    expect(() => chatText({ choices: [{ message: { content: "  " } }] })).toThrow("空");
    expect(() => chatText({})).toThrow("読めませんでした");
  });
});

describe("AI ごとの口", () => {
  test("4つの AI それぞれの宛先へ頼む", async () => {
    const urls: string[] = [];
    const fetcher = async <T,>(request: JsonRequest): Promise<T> => {
      urls.push(request.url);
      return (request.url.includes("googleapis")
        ? { candidates: [{ content: { parts: [{ text: "{}" }] } }] }
        : request.url.includes("anthropic")
          ? { content: [{ type: "text", text: "{}" }], stop_reason: "end_turn" }
          : chatOk("{}")) as T;
    };
    for (const id of ["claude", "openai", "gemini", "sakura"] as const) await typoCallerFor(id, "k", "m", fetcher)(REQUEST);
    expect(urls.map((u) => new URL(u).host)).toEqual(["api.anthropic.com", "api.openai.com", "generativelanguage.googleapis.com", "api.ai.sakura.ad.jp"]);
  });
});
