import * as fs from "node:fs";
import * as path from "node:path";
import type { HttpOptions, HttpResponse } from "@capacitor/core";
import { afterEach, describe, expect, test } from "vitest";
import { AIError, fetchJson } from "../src/shared";
import * as mobile from "../src/platform/fetchTimeouts";
import {
  NATIVE_TIMEOUT_MARGIN_MS,
  allowsWebViewFetch,
  chooseTransport,
  nativeFetch,
  setTransportForTests,
  type NativeRequest,
} from "../src/platform/fetchTimeouts";

/**
 * AI への通信（本体の `fetchJson`）が、モバイル版の送る口（`src/platform/fetchTimeouts.ts`）を
 * 通るか。端末の側（`CapacitorHttp`）は偽物に差し替えて、本体の部品から見た振る舞い——
 * 中止・待ち時間切れ・つながらない・HTTP の番号——が、パソコン版と同じ知らせになるかを見る。
 */

afterEach(() => setTransportForTests(undefined));

/** 端末の側の偽物。受け取った頼みを覚え、決めた答えを返す */
function fakeNative(answer: (options: HttpOptions) => Promise<HttpResponse>) {
  const calls: HttpOptions[] = [];
  const request: NativeRequest = (options) => {
    calls.push(options);
    return answer(options);
  };
  return { calls, request };
}

/** 本体の `fetchJson` を、端末の側の偽物につないで呼ぶ */
function viaNative(answer: (options: HttpOptions) => Promise<HttpResponse>) {
  const native = fakeNative(answer);
  setTransportForTests((url, init, timeoutMs) => nativeFetch(url, init, timeoutMs, native.request));
  return native;
}

const ok = (data: unknown, status = 200, headers: Record<string, string> = {}): Promise<HttpResponse> =>
  Promise.resolve({ data, status, headers, url: "https://example.invalid/" });

const never = (): Promise<HttpResponse> => new Promise(() => {});

async function aiErrorOf(promise: Promise<unknown>): Promise<AIError> {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e
  );
  expect(error).toBeInstanceOf(AIError);
  return error as AIError;
}

describe("本体の部品と形がそろっている", () => {
  test("本体の fetchTimeouts が外へ見せる名前を、モバイル版もすべて持つ", () => {
    // 足りない名前があると、本体の部品（Ollama の部品など）が呼んだ瞬間に落ちる
    const source = fs.readFileSync(
      path.resolve(__dirname, "../node_modules/novel-ai-assistant/src/ai/fetchTimeouts.ts"),
      "utf8"
    );
    const names = [...source.matchAll(/^export (?:async )?function (\w+)/gm)].map((m) => m[1]);
    expect(names.length).toBeGreaterThan(3);
    const missing = names.filter((n) => typeof (mobile as Record<string, unknown>)[n] !== "function");
    expect(missing).toEqual([]);
  });
});

describe("本体の fetchJson がモバイル版の口を通る", () => {
  test("答えの JSON を読んで返す。送る口には待ち時間も届く", async () => {
    const seen: { url: string; init: RequestInit; timeoutMs: number }[] = [];
    setTransportForTests(async (url, init, timeoutMs) => {
      seen.push({ url, init, timeoutMs });
      return new Response(JSON.stringify({ text: "こんにちは" }), { status: 200 });
    });
    const answer = await fetchJson<{ text: string }>({
      url: "https://ai.example.invalid/v1/generate",
      body: { prompt: "誤字を探す" },
      timeoutMs: 300_000,
      label: "テストのAI",
    });
    expect(answer.text).toBe("こんにちは");
    expect(seen).toHaveLength(1);
    expect(seen[0].timeoutMs).toBe(300_000);
    expect(seen[0].init.method).toBe("POST");
  });
});

describe("端末の側（CapacitorHttp）で投げる", () => {
  test("JSON の本文は JSON のまま渡し、待ち時間は本体の時計より少し長くする", async () => {
    const native = viaNative(() => ok({ text: "了解" }));
    await fetchJson({
      url: "https://ai.example.invalid/v1/generate",
      headers: { Authorization: "Bearer test-key" },
      body: { prompt: "縦書き", n: 1 },
      timeoutMs: 1_000,
      label: "テストのAI",
    });
    const sent = native.calls[0];
    expect(sent.method).toBe("POST");
    expect(sent.data).toEqual({ prompt: "縦書き", n: 1 });
    expect(sent.headers?.["content-type"]).toBe("application/json");
    expect(sent.headers?.["authorization"]).toBe("Bearer test-key");
    expect(sent.readTimeout).toBe(1_000 + NATIVE_TIMEOUT_MARGIN_MS);
    expect(sent.connectTimeout).toBe(1_000 + NATIVE_TIMEOUT_MARGIN_MS);
    expect(sent.responseType).toBe("text");
    // 鍵を URL に載せない（共通設計書 2.9）
    expect(sent.url).not.toContain("test-key");
  });

  test("端末が JSON を読み終えた形で返しても、文字のまま返しても、同じに読める", async () => {
    viaNative(() => ok({ text: "読み終えた形" }));
    expect(await fetchJson<{ text: string }>({ url: "https://a.invalid/", timeoutMs: 1_000, label: "AI" })).toEqual({
      text: "読み終えた形",
    });
    viaNative(() => ok('{"text":"文字のまま"}'));
    expect(await fetchJson<{ text: string }>({ url: "https://a.invalid/", timeoutMs: 1_000, label: "AI" })).toEqual({
      text: "文字のまま",
    });
  });

  test("HTTP の番号は本体と同じ種別になる（401 は鍵、429 は待つ秒数も読む）", async () => {
    viaNative(() => ok('{"error":"bad key"}', 401));
    const auth = await aiErrorOf(fetchJson({ url: "https://a.invalid/", timeoutMs: 1_000, label: "AI" }));
    expect(auth.kind).toBe("authentication_failed");
    expect(auth.detail).toContain("bad key");

    viaNative(() => ok("slow down", 429, { "Retry-After": "7" }));
    const limited = await aiErrorOf(fetchJson({ url: "https://a.invalid/", timeoutMs: 1_000, label: "AI" }));
    expect(limited.kind).toBe("rate_limited");
    expect(limited.retryAfterMs).toBe(7_000);
  });

  test("答えが来ないまま待ち時間が過ぎたら「タイムアウト」になる（端末の側を待たない）", async () => {
    viaNative(never);
    const error = await aiErrorOf(fetchJson({ url: "https://a.invalid/", timeoutMs: 30, label: "AI" }));
    expect(error.kind).toBe("timeout");
  });

  test("［中止］を押したら、端末の側を待たずに「中止」になる", async () => {
    viaNative(never);
    const controller = new AbortController();
    const pending = fetchJson({ url: "https://a.invalid/", timeoutMs: 60_000, label: "AI", signal: controller.signal });
    controller.abort();
    expect((await aiErrorOf(pending)).kind).toBe("aborted");
  });

  test("中止したあとに届いた答えは使わない", async () => {
    let deliver: (value: HttpResponse) => void = () => {};
    viaNative(() => new Promise((resolve) => (deliver = resolve)));
    const controller = new AbortController();
    const pending = fetchJson({ url: "https://a.invalid/", timeoutMs: 60_000, label: "AI", signal: controller.signal });
    await Promise.resolve();
    controller.abort();
    deliver({ data: { text: "遅れて届いた" }, status: 200, headers: {}, url: "" });
    expect((await aiErrorOf(pending)).kind).toBe("aborted");
  });

  test("つながらないときは「接続できない」になり、端末の言った理由がログ用に残る", async () => {
    viaNative(() => Promise.reject({ code: "UNKNOWN_HOST", message: "Unable to resolve host" }));
    const error = await aiErrorOf(fetchJson({ url: "https://a.invalid/", timeoutMs: 1_000, label: "AI" }));
    expect(error.kind).toBe("not_running");
    expect(error.detail).toContain("Unable to resolve host");
    expect(error.detail).toContain("UNKNOWN_HOST");
  });

  test("本文を持たない答え（204）でも Response を作れる", async () => {
    const response = await nativeFetch("https://a.invalid/", {}, 1_000, () => ok("", 204));
    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
  });
});

describe("投げ方は宛先で選ぶ（止められる所は止める）", () => {
  test("CORS を許すと確かめたクラウドの AI は、端末でも WebView の fetch で投げる", () => {
    for (const url of [
      "https://api.anthropic.com/v1/messages",
      "https://api.openai.com/v1/chat/completions",
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
    ]) {
      expect(chooseTransport(url, true)).toBe("webview");
    }
  });

  test("さくらの AI・手元の AI・見知らぬ宛先は、端末では CapacitorHttp で投げる", () => {
    for (const url of [
      "https://api.ai.sakura.ad.jp/v1/chat/completions",
      "http://100.64.0.1:11434/api/chat",
      "https://api.anthropic.com.example.invalid/v1/messages",
      "http://api.openai.com/v1/chat/completions",
      "壊れた宛先",
    ]) {
      expect(chooseTransport(url, true)).toBe("native");
    }
  });

  test("パソコンのブラウザでは、いつもふつうの fetch", () => {
    expect(chooseTransport("https://api.ai.sakura.ad.jp/v1/chat/completions", false)).toBe("webview");
  });

  test("名前の大文字・小文字や道の違いは見ない（名前だけで照らす）", () => {
    expect(allowsWebViewFetch("https://API.OpenAI.com/v1/models")).toBe(true);
    expect(allowsWebViewFetch("https://api.anthropic.com:443/v1/messages?beta=true")).toBe(true);
  });
});
