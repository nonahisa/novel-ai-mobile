import "./bufferShim";
import git, { Errors } from "isomorphic-git";
import type { createGitFs } from "./gitFs";
import type { FileStore } from "./fileStore";
import { nextAction, type ApiFailureKind, type ApiFetch, type CommitIdentity } from "./githubCommitApi";
import { pushWork } from "./workPush";
import {
  applyConflictChoice,
  fetchRemoteHead,
  integrateIncoming,
  planIncoming,
  readConflict,
  type ApplyChoiceResult,
  type ConflictChoice,
  type ConflictMaterial,
  type IntegrateResult,
} from "./syncConflict";
import { isBaselineOnlyChange, workRepo } from "./workSync";
import { forgetTouched, readTouched } from "./touchedPaths";

/**
 * **同期の画面（G）の［取ってくる］［送る］**（設計書 6章。引継ぎ書 59章）。
 * 前に作った部品をつなぐだけ：送るのは `pushWork`（GitHub の API で版を作る）、取ってくるのは
 * `fetchRemoteHead`（浅い git の取得）→ `integrateIncoming`（競合が無ければ取り込む）。
 *
 * - 合言葉（トークン）は呼ぶ側が鍵の置き場から読んで渡す。ここでは記録に出さない
 * - GitHub のどこへ送るかは、作品のリポジトリの `remote.origin.url` と今の枝で決める
 * - 書庫の中の作品は、その作品のフォルダーの中だけを送る（取ってくるのは書庫ごと）
 * - 向こうが先へ進んでいたら送らない（`behind`）。先に［取ってくる］
 * - 競合があれば何も動かさない（選ぶ画面は次の段）
 */

type GitFs = ReturnType<typeof createGitFs>;

export interface RepoTarget {
  owner: string;
  repo: string;
  branch: string;
}

/** `https://github.com/<owner>/<repo>(.git)` か `git@github.com:<owner>/<repo>(.git)` だけを読む */
export function parseGitHubUrl(url: string): { owner: string; repo: string } | undefined {
  const match = /^(?:https:\/\/(?:[^@/]+@)?github\.com\/|git@github\.com:)([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?\/?$/.exec(url.trim());
  if (!match || match[2] === "." || match[2] === "..") return undefined;
  return { owner: match[1]!, repo: match[2]! };
}

/** 作品のリポジトリの送り先。GitHub でなければ undefined */
export async function readRepoTarget(fs: GitFs, dir: string): Promise<RepoTarget | undefined> {
  try {
    const url = (await git.getConfig({ fs, dir, path: "remote.origin.url" })) as unknown;
    const parsed = typeof url === "string" ? parseGitHubUrl(url) : undefined;
    if (!parsed) return undefined;
    const branch = (await git.currentBranch({ fs, dir })) ?? "main";
    return { ...parsed, branch };
  } catch {
    return undefined;
  }
}

export type SyncOutcome =
  | { kind: "pushed"; adopted: boolean }
  | { kind: "nothing_to_push" }
  /** 向こうが先。先に［取ってくる］ */
  | { kind: "behind" }
  | { kind: "fetched"; taken: number; kept: number }
  | { kind: "up_to_date" }
  /** 自動の取得で、こちらに送っていない変更があったので取り込まなかった（取ってきただけ。原稿に触れていない） */
  | { kind: "held" }
  /** 選んでいない競合がある。何も動かしていない */
  | { kind: "conflicts"; paths: string[] }
  /** 取り込む途中で、こちらで書き換わった。何も進めていない */
  | { kind: "changed_meanwhile" }
  | { kind: "no_remote" }
  | { kind: "failed"; reason: ApiFailureKind };

/** 作者に出す1行（説明の文を並べない。次の操作が分かる短さ） */
export function outcomeText(outcome: SyncOutcome): string {
  switch (outcome.kind) {
    case "pushed":
      return outcome.adopted ? "送りました" : "送りました（手元の印は次の［取ってくる］でそろいます）";
    case "nothing_to_push":
      return "送る変更はありません";
    case "behind":
      return "GitHub のほうが新しいので送っていません。先に［取ってくる］を押してください";
    case "fetched":
      return outcome.taken > 0 ? `取ってきました（${outcome.taken}件）` : "取ってきました";
    case "up_to_date":
      return "新しい変更はありません";
    case "held":
      return "GitHub に新しい版があります。［取ってくる］で取り込みます";
    case "conflicts":
      return `両方で書き換えた話があります（${outcome.paths.length}話）。選ぶと取り込みます`;
    case "changed_meanwhile":
      return "取り込む途中で書き換わったので止めました。もう一度押してください";
    case "no_remote":
      return "この作品の GitHub の置き場が分かりません";
    case "failed":
      return nextAction(outcome.reason);
  }
}

/** git の取得の失敗を、送るときと同じ種類に分ける */
export function fetchFailure(error: unknown): ApiFailureKind {
  if (error instanceof Errors.HttpError) {
    const status = error.data.statusCode;
    if (status === 401) return "sign_in_again";
    if (status === 403 || status === 404) return "no_access";
    if (status === 429) return "rate_limited";
    if (status >= 500) return "server";
    return "unknown";
  }
  if (error instanceof TypeError) return "offline";
  return "unknown";
}

export interface SyncDeps {
  fs: GitFs;
  /** 置き場の根からの作品（`作品` か `書庫/作品`） */
  root: string;
  /** git の置き場の根（端末では空。テストは `/works` など） */
  base?: string;
  token: string;
}

/** 取ってくる。競合が無ければ取り込む */
export async function fetchWork(
  deps: SyncDeps & {
    store: FileStore;
    /** 置き場（`FileStore`）の側のリポジトリの道。省けばリポジトリの名前 */
    storeDir?: string;
    /** 向こうの版を取ってくる（省けば git の浅い取得）。テストで替える */
    fetchHead?: (target: RepoTarget) => Promise<string>;
    /**
     * 自動の取得（設計書 6章「早送りできるときだけ取り込む」）。こちらに送っていない変更（原稿でも設定でも）が
     * 1つでもあれば取り込まず `held`（取ってきた版は refs/remotes に入るので、［取ってくる］・競合の画面で使える）
     */
    fastForwardOnly?: boolean;
  }
): Promise<SyncOutcome> {
  const { dir } = workRepo(deps.root, deps.base);
  const target = await readRepoTarget(deps.fs, dir);
  if (!target) return { kind: "no_remote" };
  let theirs: string;
  try {
    theirs = deps.fetchHead
      ? await deps.fetchHead(target)
      : await fetchRemoteHead({ fs: deps.fs, dir, ...target, token: deps.token });
  } catch (error) {
    return { kind: "failed", reason: fetchFailure(error) };
  }
  const storeDir = deps.storeDir ?? deps.root.split("/")[0]!;
  const touched = await readTouched(deps.fs, dir);
  if (deps.fastForwardOnly) {
    const plan = await planIncoming({ fs: deps.fs, dir, theirs, touched });
    if (plan.theirs === plan.base) return { kind: "up_to_date" };
    if (plan.entries.some((entry) => entry.kind === "conflict")) return { kind: "held" };
    // こちらの変更があれば取り込まない。ただし字数の記録の基準を置き直しただけの変更は止めない（`workSync.ts`）
    for (const entry of plan.entries) {
      if (entry.kind === "ours_only" && !(await isBaselineOnlyChange(deps.fs, dir, entry.path))) return { kind: "held" };
    }
  }
  return integrateOutcome(await integrateIncoming({ fs: deps.fs, dir, theirs, store: deps.store, storeDir, touched }));
}

function integrateOutcome(result: IntegrateResult): SyncOutcome {
  switch (result.kind) {
    case "up_to_date":
      return { kind: "up_to_date" };
    case "conflicts":
      return { kind: "conflicts", paths: result.plan.undecided.map((entry) => entry.path) };
    case "changed_meanwhile":
      return { kind: "changed_meanwhile" };
    case "open_unsaved":
      // G の画面では原稿エディターは閉じている。来たら書き換わったのと同じに扱う
      return { kind: "changed_meanwhile" };
    case "integrated":
      return { kind: "fetched", taken: result.taken.length, kept: result.kept.length };
  }
}

/** 版の書き手。GitHub の名前と番号から、GitHub の返信しないアドレスを作る */
export function githubIdentity(login: string, id?: number): CommitIdentity {
  return { name: login, email: id ? `${id}+${login}@users.noreply.github.com` : `${login}@users.noreply.github.com` };
}

/** 送る。書庫の中の作品は、その作品のフォルダーの中だけ */
export async function sendWork(
  deps: SyncDeps & {
    author: CommitIdentity;
    message: string;
    touched?: readonly string[];
    fetcher?: ApiFetch;
    apiBase?: string;
    adopt?: (commit: string) => Promise<void>;
  }
): Promise<SyncOutcome> {
  const { dir, prefix } = workRepo(deps.root, deps.base);
  const target = await readRepoTarget(deps.fs, dir);
  if (!target) return { kind: "no_remote" };
  const result = await pushWork({
    fs: deps.fs,
    dir,
    ...target,
    token: deps.token,
    message: deps.message,
    author: deps.author,
    // アプリが書いた話（控え）も名指しする。同じ秒・同じ大きさの書き換えを送り漏らさない
    touched: [...new Set([...(deps.touched ?? []), ...(await readTouched(deps.fs, dir))])],
    filter: prefix ? (path) => path.startsWith(prefix) : undefined,
    fetcher: deps.fetcher,
    apiBase: deps.apiBase,
    adopt: deps.adopt,
  });
  switch (result.kind) {
    case "pushed":
      // 手元の枝が送った版になったら、送った作品の控えは要らない（書庫のほかの作品の控えは残す）
      if (result.adopted) await forgetTouched(deps.fs, dir, prefix ? (path) => !path.startsWith(prefix) : undefined).catch(() => undefined);
      return { kind: "pushed", adopted: result.adopted };
    case "nothing_to_push":
      return { kind: "nothing_to_push" };
    case "behind":
      return { kind: "behind" };
    case "failed":
      return { kind: "failed", reason: result.error.kind };
  }
}

/** 版の見出し（送る話の名前。3話より多ければ「ほかN話」） */
export function pushMessage(paths: readonly string[]): string {
  const names = paths.map((path) => path.slice(path.lastIndexOf("/") + 1).replace(/\.txt$/i, ""));
  if (names.length === 0) return "モバイル版で書いた";
  const shown = names.slice(0, 3).join("・");
  return names.length > 3 ? `モバイル版で書いた：${shown} ほか${names.length - 3}話` : `モバイル版で書いた：${shown}`;
}

/** 取ってきた版と競合している話（リポジトリの中の道と、選んだもの）。取ってきていなければ空 */
export async function listConflicts(
  fs: GitFs,
  root: string,
  base = ""
): Promise<Array<{ path: string; decision?: "ours" | "both" | "theirs" | "merge" }>> {
  try {
    const dir = workRepo(root, base).dir;
    const plan = await planIncoming({ fs, dir, touched: await readTouched(fs, dir) });
    return plan.conflicts.map((entry) => (entry.decision ? { path: entry.path, decision: entry.decision } : { path: entry.path }));
  } catch {
    return [];
  }
}

interface ConflictDeps {
  fs: GitFs;
  root: string;
  base?: string;
  store: FileStore;
  /** 置き場（`FileStore`）の側のリポジトリの道。省けばリポジトリの名前 */
  storeDir?: string;
}

/** 競合した話の両方の中身（選ぶ画面の材料）。もう競合でなければ undefined */
export async function readConflictMaterial(deps: ConflictDeps & { path: string }): Promise<ConflictMaterial | undefined> {
  const dir = workRepo(deps.root, deps.base).dir;
  const touched = await readTouched(deps.fs, dir);
  return readConflict({ fs: deps.fs, dir, touched, store: deps.store, storeDir: deps.storeDir ?? deps.root.split("/")[0]!, path: deps.path });
}

/**
 * 選んだものを当て、選んでいない競合が残っていなければ取り込む（全部選び終えたら取り込む。設計書 6章）。
 * `outcome` は取り込んだときだけ
 */
export async function chooseConflict(
  deps: ConflictDeps & { material: ConflictMaterial; choice: ConflictChoice; now?: Date }
): Promise<{ applied: ApplyChoiceResult; outcome?: SyncOutcome }> {
  const dir = workRepo(deps.root, deps.base).dir;
  const io = { fs: deps.fs, dir, touched: await readTouched(deps.fs, dir), store: deps.store, storeDir: deps.storeDir ?? deps.root.split("/")[0]! };
  const applied = await applyConflictChoice({ ...io, material: deps.material, choice: deps.choice, now: deps.now });
  if (!applied.ok) return { applied };
  const plan = await planIncoming(io);
  if (plan.undecided.length > 0) return { applied };
  return { applied, outcome: integrateOutcome(await integrateIncoming(io)) };
}
