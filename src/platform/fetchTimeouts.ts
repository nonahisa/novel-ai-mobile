import { Capacitor, CapacitorHttp, type HttpResponse } from "@capacitor/core";

/**
 * 本体の `ai/fetchTimeouts.ts` の**モバイル版の代わり**（設計書 2.3・3章 #7）。
 *
 * 本体の `ai/httpClient.ts`（`fetchJson`）や Ollama の部品は、AI へ投げるとき
 * `localFetch`・`cloudFetch` を通す。本体のものは Node の undici で
 * 待ち時間を延ばす作りで、端末には undici が無い。そこで、読み込みの段で
 * この部品へ差し替える（`substitutions.ts`）。**本体の部品は直さない。**
 * 外へ見せる名前と形は本体と同じにそろえる——そろっていないと、
 * 本体の部品が知らない名前を呼んで落ちる（`fetchTimeouts.test.ts` が見る）。
 *
 * ## 投げ方は宛先で選ぶ（2026-11-06 作者の裁定「止められる所は止める」）
 *
 * - **CORS（よそのサイトから読ませない決まり）を許すと確かめたクラウドの AI**
 *   （`WEBVIEW_FETCH_HOSTS`）は、**WebView のふつうの `fetch`** で投げる。
 *   ［中止］や待ち時間切れで通信そのものが途中で切れる。
 * - **それ以外**（さくらの AI・手元の AI・宛先を書き換えたもの）は `CapacitorHttp` で投げる。
 *   端末の側（Android・iOS のふつうの通信部品）で投げるので CORS に当たらないが、
 *   投げた通信を途中で切る口が無い。
 *
 * **WebView の `fetch` を丸ごと差し替える設定（`CapacitorHttp.enabled`）は使わない。**
 * 差し替えると、AI 以外の通信まで全部が端末の側を通り、どこで何が変わったのか
 * 追えなくなる。AI への通信だけを、ここで名指しで回す。
 *
 * ## `CapacitorHttp` の中止は「届いた答えを使わない」になる
 *
 * ［中止］や待ち時間切れでは、**こちらはすぐに「中止した」として返り、あとで届いた答えは捨てる**。
 * 端末の側の通信はそのまま最後まで続く。クラウドの AI でこの道を通るもの
 * （さくらの AI など）は、**中止しても料金が止まらないことがある**（設計書 3章 #7）。
 * WebView の `fetch` で切った場合も、相手が途中で生成をやめて料金を止めるかは
 * 相手しだい（本体の担当がパソコンで確かめる。2026-11-06 母艦）。
 *
 * ## 待ち時間
 *
 * 待ち時間は本体の `fetchJson` が自分の時計で見ている。端末の側の待ち時間
 * （`readTimeout`）は、それより少し長くしておく——先に端末の側が切れると、
 * 「接続できない」と取り違えた知らせになるため。本体で undici の上限
 * （300秒の壁）に当たっていた話は、端末には無い。
 *
 * ## 少しずつ受け取ること
 *
 * `CapacitorHttp` は答えを全部受け取ってから返す。`body.getReader()` で読む
 * 部品（Ollama の流れで返す形など）にも、全部まとめて一度に渡る。
 * 途中経過は出ないが、答えそのものは同じになる（WebView の `fetch` の道は、少しずつ届く）。
 */

/** 本体と同じ。`localFetch`・`cloudFetch` が受け取る形 */
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/** 端末の側の待ち時間に足す余り。本体の時計を先に鳴らすため */
export const NATIVE_TIMEOUT_MARGIN_MS = 5_000;

/**
 * 本体では undici の待ち受け役を返す。端末には undici が無いので、いつも undefined。
 * 本体の部品が呼んでも困らないように、名前だけ残す。
 */
export async function timeoutDispatcher(_timeoutMs: number): Promise<unknown | undefined> {
  return undefined;
}

/** 本体と同じ名前。覚えておく待ち受け役が無いので、何もしない */
export function clearDispatcherCache(): void {}

/** 送る口の差し替え（テスト用）。`undefined` で製品の道へ戻す */
let transportForTests: ((url: string, init: RequestInit, timeoutMs: number) => Promise<Response>) | undefined;

/** 本体と同じ名前。本体のテストの作法に合わせて残す */
export function setLocalFetchForTests(impl: FetchLike | undefined): void {
  transportForTests = impl ? (url, init) => impl(url, init) : undefined;
}

/** モバイル版のテストから、送る口を差し替える（待ち時間も受け取る） */
export function setTransportForTests(
  impl: ((url: string, init: RequestInit, timeoutMs: number) => Promise<Response>) | undefined
): void {
  transportForTests = impl;
}

/**
 * 手元の AI（作者のパソコンの Ollama・LM Studio）へ投げる口。
 * 端末からは Tailscale の道だけで呼ぶ（設計書 3章 #1）。宛先の決め方は呼ぶ側の仕事。
 */
export function localFetch(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  return send(url, init, timeoutMs);
}

/** クラウドの AI へ投げる口 */
export function cloudFetch(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  return send(url, init, timeoutMs);
}

function send(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  if (transportForTests) return transportForTests(url, init, timeoutMs);
  if (chooseTransport(url, Capacitor.isNativePlatform()) === "webview") return globalThis.fetch(url, init);
  return nativeFetch(url, init, timeoutMs);
}

/**
 * WebView の `fetch` で投げてよいと確かめた宛先（名前で照らす。道や鍵の違いは見ない）。
 *
 * **2026-11-06 に確かめた事実**（`Origin: https://localhost`＝端末の WebView の出どころで、
 * 下見の問い合わせ（OPTIONS）と、偽の鍵での本番の POST の両方を見た。
 * どれも断りの答え（401・400）にも許しの印が付き、知らせの中身まで読める）：
 * （2026-11-07：iOS の WebView の出どころ `capacitor://localhost` でも、下の3つは許すと確かめた）
 *
 * - `api.anthropic.com`：許す（`*`）。本体の部品が `anthropic-dangerous-direct-browser-access` を
 *   付けるのは、`process` が無いとき（`isWebRuntime()`）。モバイル版の組み立ては `process` を作らない
 * - `api.openai.com`：許す
 * - `generativelanguage.googleapis.com`（Gemini）：許す
 * - `api.ai.sakura.ad.jp`（さくらの AI）：**許さない**（下見に許しの印が無い）。`CapacitorHttp` のまま
 *
 * 相手の決まりは変わりうる。断られるようになると「接続できない」と出る。
 * そのときはここから外す（勝手に端末の側で投げ直さない——相手に届いてから
 * 断られた場合、投げ直すと二度払うことになる）。
 */
export const WEBVIEW_FETCH_HOSTS: readonly string[] = [
  "api.anthropic.com",
  "api.openai.com",
  "generativelanguage.googleapis.com",
];

/** 宛先が WebView の `fetch` で投げてよい相手か */
export function allowsWebViewFetch(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return parsed.protocol === "https:" && WEBVIEW_FETCH_HOSTS.includes(parsed.hostname);
}

/**
 * どちらの道で投げるか。
 *
 * パソコンのブラウザで画面を確かめるとき（`pnpm run dev`）は、いつもふつうの fetch。
 * 端末では、許すと確かめた宛先だけ WebView の fetch、ほかは `CapacitorHttp`。
 */
export function chooseTransport(url: string, isNative: boolean): "webview" | "native" {
  if (!isNative) return "webview";
  return allowsWebViewFetch(url) ? "webview" : "native";
}

/** `CapacitorHttp.request` の形（テストで差し替える） */
export type NativeRequest = typeof CapacitorHttp.request;

/**
 * `CapacitorHttp` で投げ、答えを `Response` の形に包み直す。
 *
 * 本体の部品は `ok`・`status`・`headers.get()`・`text()`・`json()`・
 * `body.getReader()` で読むので、本物の `Response` を作って返す。
 */
export async function nativeFetch(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  request: NativeRequest = (options) => CapacitorHttp.request(options)
): Promise<Response> {
  const signal = init.signal ?? undefined;
  if (signal?.aborted) throw abortError();

  const headers = headersToRecord(init.headers);
  const pending = request({
    url,
    method: init.method ?? "GET",
    headers,
    data: bodyToData(init.body, headers),
    // 答えは文字のまま受け取る。JSON を読むのは本体の部品の仕事
    responseType: "text",
    connectTimeout: timeoutMs + NATIVE_TIMEOUT_MARGIN_MS,
    readTimeout: timeoutMs + NATIVE_TIMEOUT_MARGIN_MS,
  });

  const answer = await raceWithAbort(pending, signal);
  return toResponse(answer);
}

/** 中止の印が立ったら、端末の側の答えを待たずに AbortError で返る（届いた答えは捨てる） */
function raceWithAbort(pending: Promise<HttpResponse>, signal: AbortSignal | undefined): Promise<HttpResponse> {
  const failed = pending.catch((error: unknown) => {
    throw networkError(error);
  });
  if (!signal) return failed;
  return new Promise<HttpResponse>((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener("abort", onAbort, { once: true });
    failed.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      }
    );
  });
}

/**
 * 本体の `fetchJson` は、名前が `AbortError` の失敗を「中止」か「待ち時間切れ」と読む
 * （どちらかは本体が自分で覚えている）。
 */
function abortError(): Error {
  return new DOMException("通信を中止しました", "AbortError");
}

/**
 * 端末の側の失敗（つながらない・名前が引けない など）。
 *
 * 本体の `fetchJson` は、AbortError でも自分の知らせでもない失敗を
 * 「接続できない」にし、`cause` の中身をログに残す（`describeFetchFailure`）。
 * ブラウザの fetch と同じ `TypeError` の形にそろえ、端末の言った理由は `cause` に入れる。
 */
function networkError(error: unknown): Error {
  const cause = error as { code?: unknown; message?: unknown } | undefined;
  return new TypeError("fetch failed", {
    cause: {
      code: typeof cause?.code === "string" ? cause.code : undefined,
      message: typeof cause?.message === "string" ? cause.message : String(error),
    },
  });
}

function headersToRecord(headers: HeadersInit | undefined): Record<string, string> {
  const record: Record<string, string> = {};
  new Headers(headers).forEach((value, key) => {
    record[key] = value;
  });
  return record;
}

/**
 * 送る本文。端末の側は「文字」か「JSON」しか受け取らない（`HttpOptions.data`）。
 *
 * 本体の部品は JSON を文字にしてから渡してくる。中身が JSON なら、**読み直して
 * JSON として渡す**——端末によっては、JSON の宛先に文字を渡すと
 * もう一度引用符で包んで送ってしまうため。読めなければ文字のまま渡す。
 */
function bodyToData(body: BodyInit | null | undefined, headers: Record<string, string>): unknown {
  if (body === undefined || body === null) return undefined;
  if (typeof body !== "string") {
    // 本体の AI の部品は文字しか渡さない。ほかの形が来たら、黙って崩さずに止める
    throw new TypeError("モバイル版の通信は、文字の本文だけを送れます");
  }
  const contentType = headers["content-type"] ?? "";
  if (/json/i.test(contentType)) {
    try {
      return JSON.parse(body) as unknown;
    } catch {
      return body;
    }
  }
  return body;
}

/**
 * 端末の答えを `Response` に包む。
 *
 * **答えが JSON だと、端末の側は `responseType` を無視して読み終えた形で返す**
 * （`HttpOptions.responseType` の説明）。そのときは文字に戻す。
 */
function toResponse(answer: HttpResponse): Response {
  const text = typeof answer.data === "string" ? answer.data : JSON.stringify(answer.data ?? null);
  // 中身を持てない番号（204 など）に本文を付けると、Response が作れない
  const noBody = answer.status === 204 || answer.status === 205 || answer.status === 304;
  return new Response(noBody ? null : text, {
    status: answer.status,
    headers: answer.headers,
  });
}
