import type { SyncOutcome } from "../platform/workSyncRun";

/**
 * **自動の取得**（設計書 6章「取ってくるのは自動：アプリを開いたとき・前に出たとき。早送りできるときだけ取り込む」。
 * 引継ぎ書 66章）。
 *
 * - 走らせるのは、原稿エディター・競合を選ぶ画面・縦書きの試しを開いていないときだけ（`canRun`）。
 *   開いている話を取り込みで書き換えない（取り込むと自動保存のハッシュが合わなくなり「外で変わりました」になる）
 * - 作品（リポジトリ）ごとに1つずつ。途中で作者が原稿を開いたら、次の作品へは進まない
 * - 1回走ったら、次は `minIntervalMs`（既定 5分）たつまで走らせない。重ねて走らせない
 * - サインインしていなければ何もしない。失敗は黙って次へ（押した［取ってくる］で理由が出る）
 * - 取り込むのは「こちらに送っていない変更が無い」作品だけ（`fetchWork` の `fastForwardOnly`）
 */

export interface AutoFetchDeps {
  /** git で持っている作品（リポジトリの名前） */
  listRepos(): Promise<string[]>;
  token(): Promise<string | undefined>;
  fetchOne(root: string, token: string): Promise<SyncOutcome>;
  canRun(): boolean;
  now?: () => number;
}

export const AUTO_FETCH_INTERVAL_MS = 5 * 60_000;

export interface AutoFetch {
  /** 走らせる。走ったら取り込んだ作品を返す（走らなければ undefined） */
  run(): Promise<{ fetched: string[] } | undefined>;
}

export function createAutoFetch(deps: AutoFetchDeps, minIntervalMs = AUTO_FETCH_INTERVAL_MS): AutoFetch {
  const now = deps.now ?? (() => Date.now());
  let last = Number.NEGATIVE_INFINITY;
  let running = false;
  return {
    async run() {
      if (running || !deps.canRun() || now() - last < minIntervalMs) return undefined;
      running = true;
      try {
        const token = await deps.token();
        if (!token) return undefined;
        last = now();
        const fetched: string[] = [];
        for (const root of await deps.listRepos()) {
          if (!deps.canRun()) break;
          try {
            const outcome = await deps.fetchOne(root, token);
            if (outcome.kind === "fetched") fetched.push(root);
          } catch {
            // 黙って次の作品へ
          }
        }
        return { fetched };
      } finally {
        running = false;
      }
    },
  };
}
