import { AIError, TYPO_CHECK_TEMPERATURE, fetchJson, toGeminiSchema, toOpenAIJsonSchema, type JsonRequest } from "../shared";
import type { CloudProviderId } from "./aiKeys";
import { claudeCaller, type ModelCall } from "./typoCheck";

/**
 * **誤字脱字を Claude 以外の AI にも頼む口**（段2。2026-11-18。ChatGPT・Gemini・さくらのAI）。
 *
 * 頼み方は本体の各プロバイダ（`ai/openaiProvider.ts`・`geminiProvider.ts`・`sakuraProvider.ts`）と同じ形に写す
 * （本体のものは vscode に頼るので、モバイル版からは読めない）。本体の誤字脱字（`features/checkTypos.ts`）と同じく、
 * 温度は `TYPO_CHECK_TEMPERATURE`、思考は止める、構造化出力のスキーマを付ける。
 *
 * - **鍵は頭書きにだけ置き、URL にもログにも書かない**（Gemini も `?key=` でなく `x-goog-api-key`）
 * - 受け付けられない指定は、断られたものだけ外して出し直す（本体の決まり5：エラー文から原因を当てない。
 *   どの欄が断られたかが答えに書いてあるときだけ、その欄を外す。Gemini は欄の名前を返さないので、外す順で試す）
 * - 断り・途中で切れた答え・空の答えは投げる（`checkEpisodeTypos` が区切りごとの失敗として数える。「0件」にしない）
 * - 外して通ったことは覚えない（1回の頼みの中だけ。本体は覚えるが、モバイル版は1話の数回だけなので要らない）
 */

const MAX_OUTPUT_TOKENS = 16000;
const TIMEOUT_MS = 180_000;

type Fetcher = <T>(request: JsonRequest) => Promise<T>;

/** その欄が未対応だと言われたか（本体の `isUnsupportedParameter` と同じ見方） */
export function isUnsupportedParameter(error: unknown, parameter: string): boolean {
  if (!(error instanceof AIError) || error.kind !== "bad_response") return false;
  const detail = error.detail ?? "";
  return detail.includes(parameter) && /unsupported|not supported|does not support/i.test(detail);
}

/** HTTP 400（本体の Gemini の `isInvalidArgument` と同じ見方。欄の名前は当てにしない） */
export function isInvalidArgument(error: unknown): boolean {
  if (!(error instanceof AIError) || error.kind !== "bad_response") return false;
  const detail = error.detail ?? "";
  return detail.includes("INVALID_ARGUMENT") || /invalid argument/i.test(detail) || /HTTP 400/.test(error.message);
}

interface ChatResponse {
  choices?: { message?: { content?: string | null; refusal?: string | null }; finish_reason?: string }[];
}

/** OpenAI の形の答えから字を取り出す（断り・途中で切れた・空は投げる） */
export function chatText(response: ChatResponse): string {
  const choice = response.choices?.[0];
  if (!choice) throw new Error("AI の答えの形が読めませんでした");
  if (choice.message?.refusal) throw new Error(`AI がこの本文の処理を断りました（${choice.message.refusal}）`);
  if (choice.finish_reason === "length") throw new Error("AI の答えが途中で切れました");
  const text = choice.message?.content ?? "";
  if (!text.trim()) throw new Error("AI の答えが空でした");
  return text;
}

/** ChatGPT（OpenAI）。推論系のモデルは temperature を、古いモデルは max_completion_tokens を断るので、断られたら外す・言い換える */
export function openAICaller(key: string, model: string, fetcher: Fetcher = fetchJson): ModelCall {
  return async ({ system, user, schema, signal }) => {
    const headers = { Authorization: `Bearer ${key}` };
    const body: Record<string, unknown> = {
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: TYPO_CHECK_TEMPERATURE,
      max_completion_tokens: MAX_OUTPUT_TOKENS,
      response_format: { type: "json_schema", json_schema: { name: "novelai_result", strict: true, schema: toOpenAIJsonSchema(schema as never) } },
    };
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await fetcher<ChatResponse>({ url: "https://api.openai.com/v1/chat/completions", method: "POST", headers, body, timeoutMs: TIMEOUT_MS, signal, label: "ChatGPT" });
        return chatText(response);
      } catch (error) {
        if (body.temperature !== undefined && isUnsupportedParameter(error, "temperature")) {
          delete body.temperature;
          continue;
        }
        if (body.max_completion_tokens !== undefined && isUnsupportedParameter(error, "max_completion_tokens")) {
          body.max_tokens = body.max_completion_tokens;
          delete body.max_completion_tokens;
          continue;
        }
        throw error;
      }
    }
    throw new Error("ChatGPT への頼みが受け付けられませんでした");
  };
}

/**
 * さくらのAI（OpenAI と同じ形の口）。思考を止める指定（`chat_template_kwargs`）は OpenAI の形に無い欄なので、
 * 400 なら言い回しを問わず外して試す。JSON の形の強制・温度は、断られたら外す（本体と同じ）
 */
export function sakuraCaller(key: string, model: string, fetcher: Fetcher = fetchJson): ModelCall {
  return async ({ system, user, schema, signal }) => {
    const headers = { Authorization: `Bearer ${key}` };
    const body: Record<string, unknown> = {
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: TYPO_CHECK_TEMPERATURE,
      max_tokens: MAX_OUTPUT_TOKENS,
      stream: false,
      response_format: { type: "json_schema", json_schema: { name: "novelai_result", strict: true, schema: toOpenAIJsonSchema(schema as never) } },
      // Qwen 系は enable_thinking、Kimi 系は thinking を読む。2つ一緒に送る（本体と同じ）
      chat_template_kwargs: { enable_thinking: false, thinking: false },
    };
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const response = await fetcher<ChatResponse>({ url: "https://api.ai.sakura.ad.jp/v1/chat/completions", method: "POST", headers, body, timeoutMs: TIMEOUT_MS, signal, label: "さくらのAI Engine" });
        return chatText(response);
      } catch (error) {
        if (body.response_format !== undefined && isUnsupportedParameter(error, "response_format")) {
          delete body.response_format;
          continue;
        }
        if (body.temperature !== undefined && isUnsupportedParameter(error, "temperature")) {
          delete body.temperature;
          continue;
        }
        if (body.chat_template_kwargs !== undefined && isInvalidArgument(error)) {
          delete body.chat_template_kwargs;
          continue;
        }
        throw error;
      }
    }
    throw new Error("さくらのAI への頼みが受け付けられませんでした");
  };
}

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
}

/** 答えが止められた訳のうち、作者に言うもの（本体の `BLOCKED_FINISH_REASONS` と同じ） */
const GEMINI_BLOCKED: Record<string, string> = {
  SAFETY: "安全性の判定により応答が止められました",
  PROHIBITED_CONTENT: "禁止されている内容と判定されました",
  RECITATION: "既存の著作物の引用と判定され、応答が止められました",
  BLOCKLIST: "禁止語の判定により応答が止められました",
  SPII: "個人情報を含むと判定され、応答が止められました",
};

export function geminiText(response: GeminiResponse): string {
  const blocked = response.promptFeedback?.blockReason;
  if (blocked) throw new Error(`AI が本文を受け付けませんでした（${blocked}）`);
  const candidate = response.candidates?.[0];
  if (!candidate) throw new Error("AI の答えの形が読めませんでした");
  const reason = candidate.finishReason ? GEMINI_BLOCKED[candidate.finishReason] : undefined;
  if (reason) throw new Error(reason);
  if (candidate.finishReason === "MAX_TOKENS") throw new Error("AI の答えが途中で切れました");
  const text = (candidate.content?.parts ?? []).filter((part) => !part.thought && typeof part.text === "string").map((part) => part.text).join("");
  if (!text.trim()) throw new Error("AI の答えが空でした");
  return text;
}

/**
 * Gemini。断られても欄の名前を返さない（「Request contains an invalid argument.」だけ）ので、本体と同じ順で外して試す：
 * 思考を止める指定 → スキーマ（JSON で返す指定は残す）
 */
export function geminiCaller(key: string, model: string, fetcher: Fetcher = fetchJson): ModelCall {
  return async ({ system, user, schema, signal }) => {
    const headers = { "x-goog-api-key": key };
    const plans = [
      { thinking: true, schema: true },
      { thinking: false, schema: true },
      { thinking: false, schema: false },
    ];
    const body = (plan: { thinking: boolean; schema: boolean }) => {
      const generationConfig: Record<string, unknown> = { temperature: TYPO_CHECK_TEMPERATURE, maxOutputTokens: MAX_OUTPUT_TOKENS, responseMimeType: "application/json" };
      if (plan.schema) generationConfig.responseSchema = toGeminiSchema(schema as never);
      if (plan.thinking) generationConfig.thinkingConfig = { thinkingBudget: 0 };
      return { systemInstruction: { parts: [{ text: system }] }, contents: [{ role: "user", parts: [{ text: user }] }], generationConfig };
    };
    let lastError: unknown;
    for (const plan of plans) {
      try {
        const response = await fetcher<GeminiResponse>({
          url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
          method: "POST",
          headers,
          body: body(plan),
          timeoutMs: TIMEOUT_MS,
          signal,
          label: "Gemini",
        });
        return geminiText(response);
      } catch (error) {
        if (!isInvalidArgument(error)) throw error;
        lastError = error;
      }
    }
    throw lastError;
  };
}

/** AI ごとの頼む口 */
export function typoCallerFor(provider: CloudProviderId, key: string, model: string, fetcher: Fetcher = fetchJson): ModelCall {
  switch (provider) {
    case "claude":
      return claudeCaller(key, model, fetcher);
    case "openai":
      return openAICaller(key, model, fetcher);
    case "gemini":
      return geminiCaller(key, model, fetcher);
    case "sakura":
      return sakuraCaller(key, model, fetcher);
  }
}
