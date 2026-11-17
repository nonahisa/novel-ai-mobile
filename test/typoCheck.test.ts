import { describe, expect, test, vi } from "vitest";
import { AIError, DEFAULT_MEMO_MARKERS, TYPO_CHECK_SCHEMA, applyFindingToText } from "../src/shared";
import { checkEpisodeTypos, claudeCaller, toClaudeJsonSchema, typoCheckChunks, type ModelCall } from "../src/platform/typoCheck";

/**
 * 誤字脱字（段2。`src/platform/typoCheck.ts`）。AI は偽物（どこにも送らない）。本文は作り物
 */
const TEXT = ["灯台の階段を上った。", "ししかし姉はいなかった。", "手紙だけが残っていた。"].join("\n");
const INPUT = { path: "works/灯台守_確認用/本文/第1話 手紙.txt", text: TEXT, memoMarkers: DEFAULT_MEMO_MARKERS, properNouns: ["姉"] };
const answer = (issues: unknown[]) => JSON.stringify({ issues });
const ISSUE = { line: 2, original: "ししかし姉はいなかった。", target: "ししかし", suggestion: "しかし", reason: "衍字", confidence: "high" };

describe("誤字脱字の流れ", () => {
  test("区切って頼み、本文と合う指摘を元の行で返す。当てると本文が直る", async () => {
    const call = vi.fn<ModelCall>(async () => answer([ISSUE]));
    const result = await checkEpisodeTypos(INPUT, call);
    expect(call).toHaveBeenCalledTimes(1);
    const sent = call.mock.calls[0]![0];
    expect(sent.user).toContain("2: ししかし姉はいなかった。");
    expect(sent.user).toContain("姉");
    expect(result.failures).toEqual([]);
    expect(result.findings).toEqual([{ path: INPUT.path, line: 2, original: ISSUE.original, target: "ししかし", suggestion: "しかし", reason: "衍字", confidence: "high" }]);
    const applied = applyFindingToText(TEXT, result.findings[0]!);
    expect(applied.kind).toBe("applied");
    if (applied.kind === "applied") expect(applied.text.split("\n")[1]).toBe("しかし姉はいなかった。");
  });

  test("本文に無い指摘・範囲の外の行は捨てる（AI の答えを信用しない）", async () => {
    const call: ModelCall = async () => answer([{ ...ISSUE, original: "本文に無い文。", target: "無い" }, { ...ISSUE, line: 99 }]);
    const result = await checkEpisodeTypos(INPUT, call);
    expect(result.findings).toEqual([]);
    expect(result.rejected).toBe(2);
  });

  test("読めない答え・断り・失敗は「0件」にせず、区切りごとの失敗として返す", async () => {
    expect((await checkEpisodeTypos(INPUT, async () => "すみません")).failures).toEqual([{ chunk: 1, reason: "AI の答えが読めませんでした" }]);
    const failed = await checkEpisodeTypos(INPUT, async () => {
      throw new Error("AI の答えが途中で切れました");
    });
    expect(failed.failures).toEqual([{ chunk: 1, reason: "AI の答えが途中で切れました" }]);
    expect(failed.findings).toEqual([]);
  });

  test("付箋の行・空行・CRLF の本文でも、指摘は元のファイルの行に戻り、そのまま当たる", async () => {
    const crlf = ["灯台の階段を上った。", "// 付箋：ここは後で直す", "", "ししかし姉はいなかった。"].join("\r\n");
    const lf = crlf.replace(/\r\n/g, "\n");
    // AI は送られた行番号のとおりに答える（偽物）
    const call: ModelCall = async ({ user }) => {
      const hit = user.split("\n").find((line) => line.includes("ししかし"))!;
      const line = Number(hit.slice(0, hit.indexOf(":")));
      return answer([{ ...ISSUE, line }]);
    };
    const result = await checkEpisodeTypos({ ...INPUT, text: lf }, call);
    expect(result.findings.map((f) => f.line)).toEqual([4]);
    const applied = applyFindingToText(lf, result.findings[0]!);
    expect(applied.kind).toBe("applied");
  });

  test("長い話は区切る。見積もりは区切りの数（＝呼ぶ回数）", () => {
    const long = Array.from({ length: 900 }, (_, i) => `${i}行目の文はここまで書いてある。`).join("\n");
    expect(typoCheckChunks({ ...INPUT, text: long }).length).toBeGreaterThan(1);
    expect(typoCheckChunks(INPUT)).toHaveLength(1);
  });
});

describe("Claude へ頼む口", () => {
  const ok = { content: [{ type: "text", text: answer([]) }], stop_reason: "end_turn" };
  test("鍵は頭書きだけ。URL に鍵を書かない。構造化出力のスキーマは object ごとに追加の項目を断る", async () => {
    const fetcher = vi.fn(async () => ok);
    const text = await claudeCaller("sk-ant-作り物", "claude-sonnet-5-5", fetcher as never)({ system: "S", user: "U", schema: TYPO_CHECK_SCHEMA });
    expect(text).toBe(answer([]));
    const request = (fetcher.mock.calls as unknown as unknown[][])[0]![0] as { url: string; headers: Record<string, string>; body: Record<string, unknown> };
    expect(request.url).toBe("https://api.anthropic.com/v1/messages");
    expect(request.url).not.toContain("sk-ant");
    expect(request.headers["x-api-key"]).toBe("sk-ant-作り物");
    expect(request.body).not.toHaveProperty("thinking");
    expect(JSON.stringify(request.body)).toContain('"additionalProperties":false');
  });

  test("考える深さは low。HTTP 400 で断られたら effort → 構造化出力 の順に外して試し直す。残高の不足は試し直さない", async () => {
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new AIError("Claude: HTTP 400", "bad_response"))
      .mockRejectedValueOnce(new AIError("Claude: HTTP 400", "bad_response"))
      .mockResolvedValueOnce(ok);
    await claudeCaller("k", "m", fetcher as never)({ system: "S", user: "U", schema: TYPO_CHECK_SCHEMA });
    const bodies = (fetcher.mock.calls as unknown as { body: { output_config?: { effort?: string; format?: unknown } } }[][]).map((call) => call[0]!.body);
    expect(bodies[0]!.output_config?.effort).toBe("low");
    expect(bodies[0]!.output_config?.format).toBeDefined();
    expect(bodies[1]!.output_config?.effort).toBeUndefined();
    expect(bodies[1]!.output_config?.format).toBeDefined();
    expect(bodies[2]).not.toHaveProperty("output_config");

    const broke = vi.fn().mockRejectedValue(new AIError("Claude: HTTP 400 Your credit balance is too low", "bad_response"));
    await expect(claudeCaller("k", "m", broke as never)({ system: "S", user: "U", schema: {} })).rejects.toThrow(/credit/);
    expect(broke).toHaveBeenCalledTimes(1);
    const allBad = vi.fn().mockRejectedValue(new AIError("Claude: HTTP 400", "bad_response"));
    await expect(claudeCaller("k", "m", allBad as never)({ system: "S", user: "U", schema: {} })).rejects.toThrow(/HTTP 400/);
    expect(allBad).toHaveBeenCalledTimes(3);
  });

  test("断り・途中で切れた答えは失敗にする", async () => {
    const refused = async () => ({ content: [], stop_reason: "refusal" });
    await expect(claudeCaller("k", "m", refused as never)({ system: "S", user: "U", schema: {} })).rejects.toThrow(/断りました/);
    const cut = async () => ({ content: [{ type: "text", text: "{" }], stop_reason: "max_tokens" });
    await expect(claudeCaller("k", "m", cut as never)({ system: "S", user: "U", schema: {} })).rejects.toThrow(/途中で切れました/);
  });

  test("スキーマの変換：長さの制約を外し、object に additionalProperties:false", () => {
    expect(toClaudeJsonSchema({ type: "object", properties: { a: { type: "string", maxLength: 3 } } })).toEqual({
      type: "object",
      properties: { a: { type: "string" } },
      additionalProperties: false,
    });
  });
});
