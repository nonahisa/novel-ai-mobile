import { NOT_BUILT_MESSAGE, escapeHtml, renderAppBar } from "./menuScreen";
import { askChoice } from "./dialog";
import { GITHUB_TOKEN_SECRET, type SecretVault } from "../platform/secretVault";
import {
  requestDeviceCode,
  waitForToken,
  type DeviceCode,
  type DeviceFailureKind,
  type DeviceWait,
  type PostForm,
} from "../platform/githubDeviceFlow";

/**
 * **GitHub と同期**（［ほか］→ 設定 → GitHub と同期。`#/github`。引継ぎ書 58章）。
 *
 * 作者の決めた流れ（2026-11-16）：［サインイン］→ 8字のコード → ブラウザで GitHub を開いて入れる → 許す。
 * 許されたら合言葉（トークン）を端末の鍵の置き場へしまい、「サインイン済み」と GitHub の名前を出す。
 *
 * - Client ID（作者が登録する OAuth App の。秘密ではない）が無いあいだは、［サインイン］は灰色の「未」
 * - 合言葉は画面・記録・URL に出さない
 * - 説明の文を並べない。コードは大きく、押す所は1つずつ（設計書 4.6）
 */

/** 作者の OAuth App の Client ID（作者に登録してもらってから入れる。パネル 20261116-200000-mobile-oauthapp） */
export const GITHUB_CLIENT_ID = "";

/** GitHub の名前（秘密ではない。サインイン済みの所に出す） */
export const GITHUB_LOGIN_KEY = "novelai.github.login";
/** GitHub の番号（秘密ではない。送る版の書き手のアドレス `<番号>+<名前>@users.noreply.github.com`） */
export const GITHUB_ID_KEY = "novelai.github.id";

export interface GithubUser {
  login: string;
  id?: number;
}

export const FAILURE_TEXT: Readonly<Record<DeviceFailureKind, string>> = {
  expired: "時間切れになりました",
  denied: "GitHub で断りました",
  disabled: "登録したアプリでデバイスフローが許されていません",
  bad_client: "Client ID が違います",
  network: "GitHub に届きません",
  unknown: "サインインできませんでした",
};

export const SIGN_OUT_QUESTION = "この端末から GitHub の合言葉を消します。\n送る・取ってくるには、サインインし直します";

export type GithubView =
  | { kind: "busy" }
  | { kind: "signedOut"; clientReady: boolean; failure?: DeviceFailureKind }
  | { kind: "code"; userCode: string; verificationUri: string }
  | { kind: "signedIn"; login?: string };

export function renderGithubView(view: GithubView): string {
  switch (view.kind) {
    case "busy":
      return `<div class="gh-panel" aria-busy="true"></div>`;
    case "signedOut": {
      const button = view.clientReady
        ? `<button class="primary" data-gh="signin">サインイン</button>`
        : `<button class="planned" aria-disabled="true" data-planned="${NOT_BUILT_MESSAGE}">サインイン<span class="menu-badge">未</span></button>`;
      const failure = view.failure ? `<p class="gh-state"><span class="flag warn">${escapeHtml(FAILURE_TEXT[view.failure])}</span></p>` : "";
      return `<div class="gh-panel">${failure}${button}</div>`;
    }
    case "code":
      return (
        `<div class="gh-panel">` +
        `<p class="gh-code" aria-label="コード">${escapeHtml(view.userCode)}</p>` +
        `<a class="primary gh-open" data-gh="open" href="${escapeHtml(view.verificationUri)}">コードを写して GitHub を開く</a>` +
        `<button data-gh="cancel">やめる</button>` +
        `</div>`
      );
    case "signedIn":
      return (
        `<div class="gh-panel">` +
        `<p class="gh-state"><span class="flag ok">サインイン済み</span>${view.login ? `<span class="gh-login">${escapeHtml(view.login)}</span>` : ""}</p>` +
        `<button data-gh="signout">サインアウト</button>` +
        `</div>`
      );
  }
}

export type FetchUser = (token: string) => Promise<GithubUser | undefined>;

/** 合言葉で GitHub の名前を訊く（`api.github.com` は CORS を許す） */
export const fetchGithubLogin: FetchUser = async (token) => {
  try {
    const response = await fetch("https://api.github.com/user", {
      headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}` },
    });
    if (!response.ok) return undefined;
    const data = (await response.json()) as { login?: unknown; id?: unknown };
    if (typeof data.login !== "string") return undefined;
    return { login: data.login, ...(typeof data.id === "number" ? { id: data.id } : {}) };
  } catch {
    return undefined;
  }
};

export interface GithubScreenDeps {
  vault: SecretVault;
  post: PostForm;
  clientId: string;
  fetchUser: FetchUser;
  storage?: UserStorage;
  stillHere: () => boolean;
}

type UserStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** 覚えている GitHub の名前と番号 */
export function readGithubUser(storage: UserStorage | undefined): GithubUser | undefined {
  try {
    const login = storage?.getItem(GITHUB_LOGIN_KEY);
    if (!login) return undefined;
    const id = Number(storage?.getItem(GITHUB_ID_KEY));
    return Number.isInteger(id) && id > 0 ? { login, id } : { login };
  } catch {
    return undefined;
  }
}

export function writeGithubUser(storage: UserStorage | undefined, user: GithubUser | undefined): void {
  try {
    if (user) storage?.setItem(GITHUB_LOGIN_KEY, user.login);
    else storage?.removeItem(GITHUB_LOGIN_KEY);
    if (user?.id) storage?.setItem(GITHUB_ID_KEY, String(user.id));
    else storage?.removeItem(GITHUB_ID_KEY);
  } catch {
    /* 名前を覚えられなくても、サインインは済んでいる */
  }
}

/** 画面を描いて動かす。離れるとき（`destroy`）に待つのをやめる */
export function mountGithubScreen(screen: HTMLElement, deps: GithubScreenDeps): { destroy(): void } {
  screen.innerHTML = `${renderAppBar("GitHub と同期", { back: true })}<div id="ghSlot"></div>`;
  const slot = screen.querySelector<HTMLElement>("#ghSlot")!;
  const clientReady = deps.clientId !== "";
  let wait: DeviceWait | undefined;
  let destroyed = false;
  const alive = () => !destroyed && deps.stillHere();
  const show = (view: GithubView) => {
    if (alive()) slot.innerHTML = renderGithubView(view);
  };
  const onVisible = () => {
    if (document.visibilityState === "visible") wait?.wake();
  };
  document.addEventListener("visibilitychange", onVisible);

  const begin = async () => {
    show({ kind: "busy" });
    const result = await requestDeviceCode(deps.post, deps.clientId, Date.now());
    if (!alive()) return;
    if (result.kind === "failed") return show({ kind: "signedOut", clientReady, failure: result.reason });
    awaitToken(result.code);
  };

  const awaitToken = (code: DeviceCode) => {
    show({ kind: "code", userCode: code.userCode, verificationUri: code.verificationUri });
    wait = waitForToken({ post: deps.post, clientId: deps.clientId, code });
    void wait.done.then(async (result) => {
      wait = undefined;
      if (result.kind === "stopped") return;
      if (result.kind === "failed") return show({ kind: "signedOut", clientReady, failure: result.reason });
      await deps.vault.set(GITHUB_TOKEN_SECRET, result.token);
      const user = await deps.fetchUser(result.token);
      writeGithubUser(deps.storage, user);
      show({ kind: "signedIn", login: user?.login });
    });
  };

  slot.addEventListener("click", (event) => {
    const target = (event.target as HTMLElement).closest<HTMLElement>("[data-gh]");
    if (!target) return;
    switch (target.dataset.gh) {
      case "signin":
        void begin();
        return;
      case "open": {
        // コードを写してから開く（写せなくても開く。画面にコードは出ている）
        const code = slot.querySelector(".gh-code")?.textContent ?? "";
        void navigator.clipboard?.writeText(code).catch(() => undefined);
        return;
      }
      case "cancel":
        wait?.stop();
        wait = undefined;
        show({ kind: "signedOut", clientReady });
        return;
      case "signout":
        void askChoice(SIGN_OUT_QUESTION, "サインアウト", "やめる").then(async (yes) => {
          if (!yes) return;
          await deps.vault.remove(GITHUB_TOKEN_SECRET);
          writeGithubUser(deps.storage, undefined);
          show({ kind: "signedOut", clientReady });
        });
        return;
    }
  });

  show({ kind: "busy" });
  void deps.vault.get(GITHUB_TOKEN_SECRET).then(
    (token) => show(token ? { kind: "signedIn", login: readGithubUser(deps.storage)?.login } : { kind: "signedOut", clientReady }),
    () => show({ kind: "signedOut", clientReady })
  );

  return {
    destroy() {
      destroyed = true;
      wait?.stop();
      document.removeEventListener("visibilitychange", onVisible);
    },
  };
}
