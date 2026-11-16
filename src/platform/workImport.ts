import "./bufferShim";
import git, { Errors } from "isomorphic-git";
import { createGitFs, type GitFsBackend } from "./gitFs";
import { gitHttp } from "./gitHttp";
import { removeTree } from "./git";
import { GITHUB_API, type ApiFailureKind } from "./githubCommitApi";

/**
 * **作品を GitHub から取り寄せる**（設計書 4.4.3「［作品］の［＋］→ GitHub から取り寄せる。作者のリポジトリを
 * 一覧から選ぶ。取り寄せは浅い取得」・6章。引継ぎ書 65章）。
 *
 * - 一覧は `api.github.com/user/repos`（CORS を許す。WebView の fetch）。合言葉は Authorization の頭にだけ置く
 * - 取り寄せは浅い取得（`depth: 1`・既定の枝だけ）。置き場の直下に、リポジトリの名前のフォルダーで置く
 * - **合言葉は URL にも `.git/config` にも書かない**（git の取得には `onAuth` で渡す。origin は `https://github.com/<owner>/<repo>.git`）
 * - **在るフォルダーには取り寄せない**（作者の手元の作品を上書きしない）。途中で失敗したら、作りかけのフォルダーを消す
 * - `.` で始まる名前のリポジトリは、作品一覧が隠すので取り寄せない
 */

export interface GithubRepo {
  owner: string;
  name: string;
  private: boolean;
  defaultBranch: string;
  /** 最後に送られた時刻（ms。無ければ undefined） */
  pushedAt?: number;
}

export type RepoListResult = { kind: "repos"; repos: GithubRepo[] } | { kind: "failed"; reason: ApiFailureKind };

export type Fetcher = (url: string, init: { headers: Record<string, string> }) => Promise<{ status: number; json(): Promise<unknown> }>;

const defaultFetcher: Fetcher = (url, init) => fetch(url, init);

/** 送る・取ってくると同じ分け方 */
export function statusFailure(status: number): ApiFailureKind {
  if (status === 401) return "sign_in_again";
  if (status === 403 || status === 404) return "no_access";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "server";
  return "unknown";
}

/** 作者が書き込めるリポジトリ（自分のもの・共同のもの）を、最近送った順に。100件ずつ、3頁まで */
export async function listGithubRepos(token: string, fetcher: Fetcher = defaultFetcher, apiBase = GITHUB_API): Promise<RepoListResult> {
  const repos: GithubRepo[] = [];
  for (let page = 1; page <= 3; page += 1) {
    let response: { status: number; json(): Promise<unknown> };
    try {
      response = await fetcher(`${apiBase}/user/repos?per_page=100&sort=pushed&affiliation=owner,collaborator&page=${page}`, {
        headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}` },
      });
    } catch {
      return { kind: "failed", reason: "offline" };
    }
    if (response.status !== 200) return { kind: "failed", reason: statusFailure(response.status) };
    const data = await response.json();
    if (!Array.isArray(data)) return { kind: "failed", reason: "unknown" };
    for (const item of data as Array<Record<string, unknown>>) {
      const owner = (item.owner as Record<string, unknown> | undefined)?.login;
      if (typeof item.name !== "string" || typeof owner !== "string") continue;
      const pushed = typeof item.pushed_at === "string" ? Date.parse(item.pushed_at) : NaN;
      repos.push({
        owner,
        name: item.name,
        private: item.private === true,
        defaultBranch: typeof item.default_branch === "string" ? item.default_branch : "main",
        ...(Number.isFinite(pushed) ? { pushedAt: pushed } : {}),
      });
    }
    if (data.length < 100) break;
  }
  return { kind: "repos", repos };
}

/** 置き場の直下に置けるリポジトリの名前か（作品一覧が隠す `.` で始まる名前は置かない） */
export function importableName(name: string): boolean {
  return name !== "" && !name.startsWith(".") && !/[\\/]/.test(name);
}

export type ImportResult =
  | { kind: "imported"; root: string }
  /** 同じ名前のフォルダーがもう在る（取り寄せていない） */
  | { kind: "exists"; root: string }
  | { kind: "bad_name" }
  | { kind: "failed"; reason: ApiFailureKind };

export type ImportProgress = (phase: string, loaded: number, total?: number) => void;

export type CloneFn = (input: {
  fs: ReturnType<typeof createGitFs>;
  dir: string;
  url: string;
  ref: string;
  token: string;
  onProgress?: ImportProgress;
}) => Promise<void>;

/**
 * 取り寄せの進み具合の短い字（git の段の名前を作者の言葉に。分かれば割合、分からなければ数）。
 * 段の名前は isomorphic-git と GitHub が送るもの（Counting・Compressing は GitHub の側）
 */
export function progressLabel(phase: string, loaded: number, total?: number): string {
  const name = /receiving/i.test(phase)
    ? "受け取り"
    : /resolving/i.test(phase)
      ? "組み立て"
      : /workdir/i.test(phase)
        ? "ファイルを置く"
        : "準備";
  if (total && total > 0) return `${name} ${Math.min(100, Math.floor((loaded / total) * 100))}%`;
  return loaded > 0 ? `${name} ${loaded}` : name;
}

const defaultClone: CloneFn = async ({ fs, dir, url, ref, token, onProgress }) => {
  await git.clone({
    fs,
    http: await gitHttp(),
    dir,
    url,
    ref,
    depth: 1,
    singleBranch: true,
    onAuth: () => ({ username: "x-access-token", password: token }),
    ...(onProgress ? { onProgress: (event: { phase: string; loaded: number; total?: number }) => onProgress(event.phase, event.loaded, event.total) } : {}),
  });
};

/** git の取得の失敗の分け方（`workSyncRun.fetchFailure` と同じ） */
function cloneFailure(error: unknown): ApiFailureKind {
  if (error instanceof Errors.HttpError) return statusFailure(error.data.statusCode);
  if (error instanceof TypeError) return "offline";
  return "unknown";
}

/** 取り寄せる。`base` は git の置き場の根（端末では空） */
export async function importWork(input: {
  backend: GitFsBackend;
  repo: GithubRepo;
  token: string;
  base?: string;
  clone?: CloneFn;
  onProgress?: ImportProgress;
}): Promise<ImportResult> {
  const { backend, repo } = input;
  if (!importableName(repo.name)) return { kind: "bad_name" };
  const root = repo.name;
  const dir = `${input.base ?? ""}/${root}`;
  if (await backend.stat(dir)) return { kind: "exists", root };
  const fs = createGitFs(backend);
  try {
    await (input.clone ?? defaultClone)({
      fs,
      dir,
      url: `https://github.com/${repo.owner}/${repo.name}.git`,
      ref: repo.defaultBranch,
      token: input.token,
      ...(input.onProgress ? { onProgress: input.onProgress } : {}),
    });
  } catch (error) {
    // 作りかけのフォルダーを残さない（次に取り寄せ直せるように。作者の作品ではない：在れば初めに断っている）
    await removeTree(backend, dir).catch(() => undefined);
    return { kind: "failed", reason: cloneFailure(error) };
  }
  return { kind: "imported", root };
}
