import {
  AIError,
  TYPO_CHECK_SCHEMA,
  TYPO_CHECK_SYSTEM_PROMPT,
  buildTypoCheckPrompt,
  chunksOfEpisodeFile,
  fetchJson,
  locateChunkLine,
  looksArchaicText,
  parseTypoCheckResult,
  validateTypoIssues,
  withLineNumbers,
  type Chunk,
  type JsonRequest,
  type MemoMarkers,
} from "../shared";

/**
 * **誤字脱字**（段2。設計書 7章・10章）。1話の本文を区切って AI に見せ、本文と合う指摘だけを返す。
 *
 * 区切り・行番号・頼みの文・答えの読み方と確かめは本体と同じ部品（`shared.ts`）。本体の流れ
 * （`features/checkTypos.ts`）は vscode に頼るので、同じ順に並べ直す：
 * 区切る → 行番号を振る → 頼む → 答えを読む → 本文と合うかを確かめる（`validateTypoIssues`）→ 元の行へ戻す（`locateChunkLine`）。
 * **AI の答えは信用しない**（本体の決まり3）：本文に無い指摘・元の行へ戻せない指摘は捨てる。
 * **失敗は「0件」にしない**：読めない答え・断り・途中で切れた答えは、区切りごとの失敗として返す
 */

/** 本文へ当てる前の1件。`line` は元のファイルの行（1から） */
export interface TypoFinding {
  path: string;
  line: number;
  original: string;
  target: string;
  suggestion: string;
  reason: string;
  confidence: "high" | "medium" | "low";
}

export interface TypoCheckFailure {
  /** 区切りの番号（1から） */
  chunk: number;
  reason: string;
}

export interface TypoCheckResult {
  findings: TypoFinding[];
  failures: TypoCheckFailure[];
  /** AI を呼んだ回数 */
  calls: number;
  /** 本文と合わずに捨てた指摘の数 */
  rejected: number;
}

/** AI へ1回頼む口（AI ごとに作る。答えの文を返す） */
export type ModelCall = (request: { system: string; user: string; schema: unknown; signal?: AbortSignal }) => Promise<string>;

/** 区切りの大きさ（本体の既定と同じ） */
export const TYPO_CHUNK_CHARS = 8000;

export interface TypoCheckInput {
  path: string;
  /** 話の本文（改行は LF にそろえて渡す） */
  text: string;
  chapter?: { chapterStart: number | null; chapterEnd: number | null };
  memoMarkers: MemoMarkers;
  /** 指摘しない名前（作品の用語。本体と同じく 200 まで） */
  properNouns: readonly string[];
}

/** 区切り。見積もり（何回呼ぶか）にも使う */
export function typoCheckChunks(input: TypoCheckInput): Chunk[] {
  return chunksOfEpisodeFile(input.path, input.text, input.chapter ?? { chapterStart: null, chapterEnd: null }, {
    maxChars: TYPO_CHUNK_CHARS,
    memoMarkers: input.memoMarkers,
  });
}

export async function checkEpisodeTypos(input: TypoCheckInput, call: ModelCall, signal?: AbortSignal): Promise<TypoCheckResult> {
  const chunks = typoCheckChunks(input);
  const names = [...new Set(input.properNouns)].slice(0, 200);
  const archaic = looksArchaicText(input.text);
  const result: TypoCheckResult = { findings: [], failures: [], calls: 0, rejected: 0 };
  for (const [index, chunk] of chunks.entries()) {
    if (signal?.aborted) break;
    const user = buildTypoCheckPrompt({ chunkTextWithLineNumbers: withLineNumbers(chunk), properNounDictionary: names });
    let text: string;
    try {
      result.calls++;
      text = await call({ system: TYPO_CHECK_SYSTEM_PROMPT, user, schema: TYPO_CHECK_SCHEMA, signal });
    } catch (error) {
      // 1つの区切りの失敗で全体を止めない（本体と同じ）。止めたいのは中止のときだけ
      if (signal?.aborted) break;
      result.failures.push({ chunk: index + 1, reason: error instanceof Error ? error.message : String(error) });
      continue;
    }
    const parsed = parseTypoCheckResult(text);
    if (!parsed) {
      result.failures.push({ chunk: index + 1, reason: "AI の答えが読めませんでした" });
      continue;
    }
    const checked = validateTypoIssues(parsed, chunk, names, [], { archaicWork: archaic });
    result.rejected += checked.rejected.length;
    for (const issue of checked.accepted) {
      const at = locateChunkLine(chunk, issue.line);
      if (!at) {
        result.rejected++;
        continue;
      }
      result.findings.push({
        path: input.path,
        line: at.line,
        original: issue.original,
        target: issue.target,
        suggestion: issue.suggestion,
        reason: issue.reason,
        confidence: issue.confidence,
      });
    }
  }
  return result;
}

/* ---------- Claude ---------- */

const ANTHROPIC_VERSION = "2023-06-01";

/**
 * Claude の構造化出力のスキーマ（本体の `toClaudeJsonSchema` と同じ決まり。本体のものは vscode に頼る所にあるので写す）：
 * どの object にも `additionalProperties: false`、長さ・個数の制約は外す
 */
export function toClaudeJsonSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(toClaudeJsonSchema);
  if (!schema || typeof schema !== "object") return schema;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema as Record<string, unknown>)) {
    if (key === "minLength" || key === "maxLength" || key === "maxItems" || key === "minItems") continue;
    out[key] = toClaudeJsonSchema(value);
  }
  if (out.type === "object" && !("additionalProperties" in out)) out.additionalProperties = false;
  return out;
}

interface ClaudeMessage {
  content?: { type: string; text?: string }[];
  stop_reason?: string;
  stop_details?: { explanation?: string } | null;
}

/**
 * Claude へ頼む口。**鍵は頭書き（x-api-key）にだけ置き、URL にもログにも書かない。**
 * WebView から直に呼ぶので、本体のブラウザ版と同じく `anthropic-dangerous-direct-browser-access` を付ける
 * （鍵は端末の鍵の保管にあり、作者の端末から作者の鍵で呼ぶ）。
 * 思考を切る指定は送らない（新しいモデルは 400 で断る）。代わりに effort を low にする。
 * 残高の不足は外しても直らないので、そのまま返す（本体と同じ）
 */
export function claudeCaller(key: string, model: string, fetcher: <T>(request: JsonRequest) => Promise<T> = fetchJson): ModelCall {
  return async ({ system, user, schema, signal }) => {
    const headers = { "x-api-key": key, "anthropic-version": ANTHROPIC_VERSION, "anthropic-dangerous-direct-browser-access": "true" };
    // 本体と同じく、抽出の頼みは考える深さを低め（effort low）にする（作者の鍵で払うので、思考を長く回さない）。
    // 受け付けないモデルには 400 で断られるので、effort → 構造化出力 の順に外して試し直す（本体の claudeAttemptPlan と同じ考え）
    const plans = [
      { schema: true, effort: true },
      { schema: true, effort: false },
      { schema: false, effort: false },
    ];
    const body = (plan: { schema: boolean; effort: boolean }) => {
      const config: Record<string, unknown> = {};
      if (plan.schema) config.format = { type: "json_schema", schema: toClaudeJsonSchema(schema) };
      if (plan.effort) config.effort = "low";
      return { model, max_tokens: 16000, system, messages: [{ role: "user", content: user }], ...(Object.keys(config).length > 0 ? { output_config: config } : {}) };
    };
    let res: ClaudeMessage | undefined;
    let lastError: unknown;
    for (const plan of plans) {
      try {
        res = await fetcher<ClaudeMessage>({ url: "https://api.anthropic.com/v1/messages", method: "POST", headers, body: body(plan), timeoutMs: 180_000, signal, label: "Claude" });
        break;
      } catch (error) {
        lastError = error;
        const message = error instanceof Error ? error.message : String(error);
        const detail = error instanceof AIError ? (error.detail ?? "") : "";
        // 残高の不足は外しても直らない。400 以外（鍵・通信・待ち切れ）はそのまま返す
        if (/credit balance|billing/i.test(`${message} ${detail}`)) throw error;
        if (!(error instanceof AIError && error.kind === "bad_response" && /HTTP 400/.test(message))) throw error;
      }
    }
    if (!res) throw lastError;
    if (res.stop_reason === "refusal") {
      throw new Error(`AI がこの本文の処理を断りました${res.stop_details?.explanation ? `（${res.stop_details.explanation}）` : ""}`);
    }
    if (res.stop_reason === "max_tokens") throw new Error("AI の答えが途中で切れました");
    const text = (res.content ?? []).filter((block) => block.type === "text" && typeof block.text === "string").map((block) => block.text).join("");
    if (!text) throw new Error("AI の答えが空でした");
    return text;
  };
}
