import { describe, expect, test } from "vitest";
import { pollOnce, requestDeviceCode, waitForToken, type DeviceCode, type PostForm } from "../src/platform/githubDeviceFlow";
import { renderGithubView } from "../src/app/githubScreen";

/** GitHub のサインイン（デバイスフロー。引継ぎ書 58章）。GitHub は偽物。合言葉も作り物 */

const FAKE_TOKEN = "gho_tukurimono_0000";

function fakePost(answers: Array<{ status?: number; data: unknown } | Error>) {
  const calls: Array<{ url: string; form: Record<string, string> }> = [];
  const post: PostForm = async (url, form) => {
    calls.push({ url, form });
    const next = answers.shift();
    if (!next) throw new Error("答えが尽きた");
    if (next instanceof Error) throw next;
    return { status: next.status ?? 200, data: next.data };
  };
  return { post, calls };
}

const code: DeviceCode = {
  deviceCode: "d".repeat(40),
  userCode: "WDJB-MJHT",
  verificationUri: "https://github.com/login/device",
  expiresAt: 900_000,
  intervalMs: 5_000,
};

describe("合言葉を頼む", () => {
  test("Client ID と repo の権限で頼み、コード・開く頁・期限・間を受け取る", async () => {
    const { post, calls } = fakePost([
      { data: { device_code: "d".repeat(40), user_code: "WDJB-MJHT", verification_uri: "https://github.com/login/device", expires_in: 900, interval: 5 } },
    ]);
    expect(await requestDeviceCode(post, "Ov-test", 1_000)).toEqual({
      kind: "code",
      code: { deviceCode: "d".repeat(40), userCode: "WDJB-MJHT", verificationUri: "https://github.com/login/device", expiresAt: 901_000, intervalMs: 5_000 },
    });
    expect(calls).toEqual([{ url: "https://github.com/login/device/code", form: { client_id: "Ov-test", scope: "repo" } }]);
  });

  test("登録でデバイスフローを許していない・届かない・GitHub の外の頁は失敗", async () => {
    expect(await requestDeviceCode(fakePost([{ status: 400, data: { error: "device_flow_disabled" } }]).post, "Ov", 0)).toEqual({ kind: "failed", reason: "disabled" });
    expect(await requestDeviceCode(fakePost([new TypeError("Failed to fetch")]).post, "Ov", 0)).toEqual({ kind: "failed", reason: "network" });
    const elsewhere = { device_code: "d", user_code: "A-B", verification_uri: "https://example.invalid/login", expires_in: 900, interval: 5 };
    expect(await requestDeviceCode(fakePost([{ data: elsewhere }]).post, "Ov", 0)).toEqual({ kind: "failed", reason: "unknown" });
  });
});

describe("許されるまで訊く", () => {
  test("1回の訊き方：まだ・遅くせよ（5秒のばす）・取れた・断った・時間切れ", async () => {
    const { post, calls } = fakePost([
      { data: { error: "authorization_pending" } },
      { data: { error: "slow_down", interval: 10 } },
      { data: { error: "slow_down" } },
      { data: { access_token: FAKE_TOKEN, token_type: "bearer", scope: "repo" } },
      { data: { error: "access_denied" } },
      { data: { error: "expired_token" } },
    ]);
    expect(await pollOnce(post, "Ov", code)).toEqual({ kind: "pending", intervalMs: 5_000 });
    expect(await pollOnce(post, "Ov", code)).toEqual({ kind: "pending", intervalMs: 10_000 });
    expect(await pollOnce(post, "Ov", code)).toEqual({ kind: "pending", intervalMs: 10_000 });
    expect(await pollOnce(post, "Ov", code)).toEqual({ kind: "token", token: FAKE_TOKEN, scope: "repo" });
    expect(await pollOnce(post, "Ov", code)).toEqual({ kind: "failed", reason: "denied" });
    expect(await pollOnce(post, "Ov", code)).toEqual({ kind: "failed", reason: "expired" });
    expect(calls[0]).toEqual({
      url: "https://github.com/login/oauth/access_token",
      form: { client_id: "Ov", device_code: "d".repeat(40), grant_type: "urn:ietf:params:oauth:grant-type:device_code" },
    });
  });

  test("時刻で決める：タイマーが早く鳴っても、裏から戻っても、間より早く訊かない。遅くせよで間がのびる", async () => {
    let clock = 0;
    const timers: Array<{ run: () => void; at: number }> = [];
    const { post, calls } = fakePost([{ data: { error: "slow_down" } }, { data: { access_token: FAKE_TOKEN, scope: "repo" } }]);
    const wait = waitForToken({
      post,
      clientId: "Ov",
      code,
      now: () => clock,
      setTimer: (run, ms) => timers.push({ run, at: clock + ms }),
      clearTimer: () => undefined,
    });
    const flush = () => new Promise((r) => setTimeout(r, 0));
    clock = 1_000;
    wait.wake(); // 戻ってきたが、まだ 5 秒たっていない
    await flush();
    expect(calls).toHaveLength(0);
    clock = 5_000;
    wait.wake();
    await flush();
    expect(calls).toHaveLength(1); // slow_down → 次は 10 秒あと
    clock = 14_000;
    wait.wake();
    await flush();
    expect(calls).toHaveLength(1);
    clock = 15_000;
    timers.at(-1)!.run();
    expect(await wait.done).toEqual({ kind: "token", token: FAKE_TOKEN, scope: "repo" });
    expect(calls).toHaveLength(2);
  });

  test("期限を過ぎたら訊かずに時間切れ。やめたら stopped", async () => {
    let clock = 0;
    const late = waitForToken({ post: fakePost([]).post, clientId: "Ov", code, now: () => clock, setTimer: () => 0, clearTimer: () => undefined });
    clock = 900_000;
    late.wake();
    expect(await late.done).toEqual({ kind: "failed", reason: "expired" });
    const stopped = waitForToken({ post: fakePost([]).post, clientId: "Ov", code, now: () => 0, setTimer: () => 0, clearTimer: () => undefined });
    stopped.stop();
    expect(await stopped.done).toEqual({ kind: "stopped" });
  });
});

describe("GitHub と同期の画面", () => {
  test("Client ID が無いあいだは［サインイン］は灰色の未。コードの画面・サインイン済みに合言葉は出ない", () => {
    expect(renderGithubView({ kind: "signedOut", clientReady: false })).toContain('aria-disabled="true"');
    expect(renderGithubView({ kind: "signedOut", clientReady: true })).toContain('data-gh="signin"');
    const codeView = renderGithubView({ kind: "code", userCode: "WDJB-MJHT", verificationUri: "https://github.com/login/device" });
    expect(codeView).toContain("WDJB-MJHT");
    expect(codeView).toContain('href="https://github.com/login/device"');
    const signedIn = renderGithubView({ kind: "signedIn", login: "sakka" });
    expect(signedIn).toContain("サインイン済み");
    expect(signedIn).toContain("sakka");
    expect(signedIn).not.toContain(FAKE_TOKEN);
  });
});
