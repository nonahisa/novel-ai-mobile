import { Capacitor, CapacitorHttp, type HttpOptions, type HttpResponse } from "@capacitor/core";
import type { GitHttpRequest, GitHttpResponse, HttpClient } from "isomorphic-git";
import { base64ToBytes } from "./capacitorFileStore";

/**
 * isomorphic-git に渡す通信の口（段0の試作。設計書 6章）。
 *
 * GitHub の git の口（`https://github.com/…/info/refs` など）は CORS を許していないので、
 * WebView の `fetch` からは届かない。端末の側の通信（`CapacitorHttp`）で投げる
 * （AI への通信と同じ理由。`fetchTimeouts.ts`）。
 *
 * ## 送る本文は文字だけ
 *
 * `CapacitorHttp` は本文を「文字」か「JSON」でしか受け取らない。取得（clone・fetch）で
 * 送るのは「この版が欲しい」という ASCII の行だけなので、文字のまま送れる。
 * **送信（push）は版の中身（圧縮した2進のデータ）を送るので、この口では送れない。**
 * 0x80 以上のバイトが混じったら、壊して送らずに止める（`GitBinaryBodyError`）。
 * 送信の道は、送信を試すときに別に作る（設計書 6章の【確かめる】）。
 */

export class GitBinaryBodyError extends Error {
  constructor() {
    super("この通信の口は、2進のデータ（git の送信）を送れません");
    this.name = "GitBinaryBodyError";
  }
}

async function collect(body: AsyncIterableIterator<Uint8Array> | undefined): Promise<Uint8Array | undefined> {
  if (!body) return undefined;
  const chunks: Uint8Array[] = [];
  for await (const chunk of body) chunks.push(chunk);
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.length;
  }
  return joined;
}

/** ASCII だけなら文字にする。それ以外は送れない */
export function asciiBody(bytes: Uint8Array): string {
  let text = "";
  for (const byte of bytes) {
    if (byte >= 0x80) throw new GitBinaryBodyError();
    text += String.fromCharCode(byte);
  }
  return text;
}

async function* once(bytes: Uint8Array): AsyncIterableIterator<Uint8Array> {
  yield bytes;
}

export type NativeHttpRequest = (options: HttpOptions) => Promise<HttpResponse>;

/** 端末の側で投げる。`request` はテストで差し替える */
export function createNativeGitHttp(
  request: NativeHttpRequest = (options) => CapacitorHttp.request(options)
): HttpClient {
  return {
    async request(req: GitHttpRequest): Promise<GitHttpResponse> {
      const body = await collect(req.body);
      const answer = await request({
        url: req.url,
        method: req.method ?? "GET",
        headers: req.headers ?? {},
        data: body && body.length > 0 ? asciiBody(body) : undefined,
        // 2進のまま受け取る（端末の側は base64 の文字にして返す）
        responseType: "arraybuffer",
      });
      const bytes = typeof answer.data === "string" ? base64ToBytes(answer.data) : new Uint8Array(0);
      const headers: Record<string, string> = {};
      for (const [key, value] of Object.entries(answer.headers ?? {})) headers[key.toLowerCase()] = value;
      return {
        url: answer.url || req.url,
        method: req.method ?? "GET",
        statusCode: answer.status,
        statusMessage: String(answer.status),
        headers,
        body: once(bytes),
      };
    },
  };
}

/** 端末では端末の側の口。パソコンのブラウザでは、ふつうの fetch（GitHub には CORS で断られる） */
export async function gitHttp(): Promise<HttpClient> {
  if (Capacitor.isNativePlatform()) return createNativeGitHttp();
  return (await import("isomorphic-git/http/web")).default;
}
