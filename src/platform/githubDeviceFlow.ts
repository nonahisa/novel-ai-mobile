import { CapacitorHttp } from "@capacitor/core";

/**
 * GitHub のサインイン（デバイスフロー。設計書 6章・引継ぎ書 58章）。
 *
 * 1. 合言葉を頼む（`login/device/code`）→ 8字のコードと、開く頁（`https://github.com/login/device`）
 * 2. 作者がブラウザでコードを入れて許すまで、決まった間をあけて訊く（`login/oauth/access_token`）
 *
 * - **`github.com/login/*` は CORS を許さない**（下見の OPTIONS が 404。2026-11-16 に確かめた）ので、
 *   端末の側の通信（`CapacitorHttp`）で投げる。秘密の鍵（client secret）は使わない
 * - 答えの種類は本文の `error` で分ける（名前は docs.github.com の表のとおり）
 * - `slow_down` は間を 5 秒のばす（答えに新しい `interval` があればそれ）
 * - **合言葉（トークン）は記録・URL に書かない。** ここでは返すだけ
 */

export const GITHUB_WEB = "https://github.com";
/** 非公開の原稿の置き場へ送るのに要る */
export const DEVICE_SCOPE = "repo";
const DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";

/** 端末の側で、フォームの形で POST して JSON を受ける口（テストで差し替える） */
export type PostForm = (url: string, form: Record<string, string>) => Promise<{ status: number; data: unknown }>;

export const nativePostForm: PostForm = async (url, form) => {
  const response = await CapacitorHttp.request({
    url,
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    // フォームは物で渡す（Android・iOS・ブラウザのどれも、CapacitorHttp が `a=b&c=d` に組む）
    data: form,
  });
  let data: unknown = response.data;
  if (typeof data === "string") {
    try {
      data = JSON.parse(data);
    } catch {
      /* JSON でない答えは、そのまま「分からない」になる */
    }
  }
  return { status: response.status, data };
};

export interface DeviceCode {
  deviceCode: string;
  /** 作者が入れる 8 字（真ん中にハイフン） */
  userCode: string;
  /** 作者が開く頁 */
  verificationUri: string;
  /** この時刻（ms）を過ぎたらコードは使えない */
  expiresAt: number;
  /** 訊く間（ms）の下限 */
  intervalMs: number;
}

/**
 * 失敗の種類。`expired`：時間切れ（もう一度）・`denied`：ブラウザで断った・`disabled`：登録で
 * デバイスフローを許していない・`bad_client`：Client ID が違う・`network`：届かない・`unknown`
 */
export type DeviceFailureKind = "expired" | "denied" | "disabled" | "bad_client" | "network" | "unknown";

export type DeviceCodeResult = { kind: "code"; code: DeviceCode } | { kind: "failed"; reason: DeviceFailureKind };

export type PollStep =
  | { kind: "pending"; intervalMs: number }
  | { kind: "token"; token: string; scope: string }
  | { kind: "failed"; reason: DeviceFailureKind };

function record(data: unknown): Record<string, unknown> {
  return data !== null && typeof data === "object" ? (data as Record<string, unknown>) : {};
}

function failureOf(error: unknown): DeviceFailureKind {
  switch (error) {
    case "expired_token":
    case "token_expired":
      return "expired";
    case "access_denied":
      return "denied";
    case "device_flow_disabled":
      return "disabled";
    case "incorrect_client_credentials":
      return "bad_client";
    default:
      return "unknown";
  }
}

/** 合言葉を頼む */
export async function requestDeviceCode(post: PostForm, clientId: string, now: number): Promise<DeviceCodeResult> {
  let response: { status: number; data: unknown };
  try {
    response = await post(`${GITHUB_WEB}/login/device/code`, { client_id: clientId, scope: DEVICE_SCOPE });
  } catch {
    return { kind: "failed", reason: "network" };
  }
  const data = record(response.data);
  if (typeof data.error === "string") return { kind: "failed", reason: failureOf(data.error) };
  const { device_code, user_code, verification_uri, expires_in, interval } = data;
  if (
    response.status !== 200 ||
    typeof device_code !== "string" ||
    typeof user_code !== "string" ||
    typeof verification_uri !== "string" ||
    !verification_uri.startsWith(`${GITHUB_WEB}/`)
  ) {
    return { kind: "failed", reason: response.status === 404 ? "bad_client" : "unknown" };
  }
  const seconds = (value: unknown, fallback: number) => (typeof value === "number" && value > 0 ? value : fallback);
  return {
    kind: "code",
    code: {
      deviceCode: device_code,
      userCode: user_code,
      verificationUri: verification_uri,
      expiresAt: now + seconds(expires_in, 900) * 1000,
      intervalMs: seconds(interval, 5) * 1000,
    },
  };
}

/** 1回訊く。まだなら次に訊くまでの間（ms）を返す */
export async function pollOnce(post: PostForm, clientId: string, code: DeviceCode): Promise<PollStep> {
  let response: { status: number; data: unknown };
  try {
    response = await post(`${GITHUB_WEB}/login/oauth/access_token`, {
      client_id: clientId,
      device_code: code.deviceCode,
      grant_type: DEVICE_GRANT,
    });
  } catch {
    // 届かなかっただけ。同じ間で訊き直す（コードはまだ生きている）
    return { kind: "pending", intervalMs: code.intervalMs };
  }
  const data = record(response.data);
  if (typeof data.access_token === "string" && data.access_token !== "") {
    return { kind: "token", token: data.access_token, scope: typeof data.scope === "string" ? data.scope : "" };
  }
  if (data.error === "authorization_pending") return { kind: "pending", intervalMs: code.intervalMs };
  if (data.error === "slow_down") {
    const given = typeof data.interval === "number" && data.interval > 0 ? data.interval * 1000 : 0;
    return { kind: "pending", intervalMs: Math.max(given, code.intervalMs + 5_000) };
  }
  return { kind: "failed", reason: failureOf(data.error) };
}

export type DeviceWaitResult = { kind: "token"; token: string; scope: string } | { kind: "failed"; reason: DeviceFailureKind } | { kind: "stopped" };

export interface DeviceWaitOptions {
  post: PostForm;
  clientId: string;
  code: DeviceCode;
  now?: () => number;
  setTimer?: (run: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export interface DeviceWait {
  /** 済んだら（取れた・失敗・やめた）一度だけ */
  done: Promise<DeviceWaitResult>;
  /** アプリへ戻ってきたとき。間が過ぎていればすぐ訊く（裏ではタイマーが止まる） */
  wake(): void;
  /** やめる（画面を離れた） */
  stop(): void;
}

/**
 * 許されるまで訊き続ける。**時刻で決める**：タイマーは目覚ましにすぎず、裏に回って遅れても
 * 早く訊きすぎない（次に訊いてよい時刻を持つ）。時間切れを過ぎたら訊かずに `expired`
 */
export function waitForToken(options: DeviceWaitOptions): DeviceWait {
  const now = options.now ?? (() => Date.now());
  const setTimer = options.setTimer ?? ((run, ms) => setTimeout(run, ms));
  const clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  let intervalMs = options.code.intervalMs;
  let nextAt = now() + intervalMs;
  let timer: unknown;
  let inFlight = false;
  let finished = false;
  let resolve!: (result: DeviceWaitResult) => void;
  const done = new Promise<DeviceWaitResult>((r) => (resolve = r));

  const finish = (result: DeviceWaitResult) => {
    if (finished) return;
    finished = true;
    if (timer !== undefined) clearTimer(timer);
    timer = undefined;
    resolve(result);
  };
  const schedule = () => {
    if (finished) return;
    if (timer !== undefined) clearTimer(timer);
    timer = setTimer(tick, Math.max(0, Math.min(nextAt, options.code.expiresAt) - now()));
  };
  const tick = () => {
    timer = undefined;
    if (finished || inFlight) return;
    const t = now();
    if (t >= options.code.expiresAt) return finish({ kind: "failed", reason: "expired" });
    if (t < nextAt) return schedule();
    inFlight = true;
    void pollOnce(options.post, options.clientId, { ...options.code, intervalMs }).then((step) => {
      inFlight = false;
      if (finished) return;
      if (step.kind === "token") return finish(step);
      if (step.kind === "failed") return finish(step);
      intervalMs = step.intervalMs;
      nextAt = now() + intervalMs;
      schedule();
    });
  };
  schedule();
  return {
    done,
    wake: () => tick(),
    stop: () => finish({ kind: "stopped" }),
  };
}
