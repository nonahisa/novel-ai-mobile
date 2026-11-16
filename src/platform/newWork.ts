import { GITHUB_API, type ApiFailureKind } from "./githubCommitApi";
import { importWork, statusFailure, type CloneFn, type Fetcher, type GithubRepo } from "./workImport";
import type { GitFsBackend } from "./gitFs";
import { joinStorePath, type FileStore } from "./fileStore";

/**
 * **新しく作る**（［作品］の［＋］→ 新しく作る。設計書 4.4.3。作者の答え 2026-11-16「毎回非公開で作る」。引継ぎ書 75章）。
 *
 * 1. 作品の題（日本語でよい）と、GitHub のリポジトリの名前（英数字）を訊く。作る前に「GitHub に非公開のリポジトリ〈名前〉を作ります」と確かめる
 * 2. GitHub に非公開のリポジトリを作る（`POST /user/repos`。`auto_init` で最初の版を作る＝送る口がそのまま使える）
 * 3. それを取り寄せる（65章の `importWork`。合言葉は URL にも `.git/config` にも書かない）
 * 4. 中に本体の「本文起点」と同じ形を置く（`.aiwriter/config.json`・`.gitignore`・`本文/001.txt`。送るのは作者が［送る］を押したとき）
 *
 * **端末に同じ名前のフォルダーがあれば、GitHub に作る前に止める**（作者の手元の作品を上書きしない）。
 * 本体の形は `core/workRegistry.ts` の `scaffoldWorkFolder`（vscode に頼るので写す。`test/newWork.test.ts` が本体の除外の一覧と照らす）
 */

/** 本体の `IGNORED_PATHS`（core/workRegistry.ts）の写し。試験が本体と照らす */
export const IGNORED_PATHS: readonly string[] = [
  ".aiwriter/cache/",
  ".aiwriter/logs/",
  ".aiwriter/exports/",
  ".aiwriter/generated/",
  ".aiwriter/reports/",
  ".aiwriter/external-access.json",
  ".aiwriter/history/spotlight.jsonl",
  ".aiwriter/ai-instruction-usage.json",
  ".novelai-recovery/",
  "exports/",
];

/** 本体の `scaffoldWorkFolder` が書く `.gitignore`（キャッシュは同期しない既定のとき） */
export function newWorkGitignore(): string {
  return ["# 小説AI執筆補助が生成する作業ファイル（再生成できるため同期しない）", ...IGNORED_PATHS, ""].join("\n");
}

/** 本体の `scaffoldWorkFolder` が書く作品の設定（小説。種類は書かない） */
export function newWorkConfig(title: string, now: Date): string {
  return JSON.stringify(
    { schemaVersion: "0.1", workTitle: title, manuscriptDir: "本文", settingsDir: "設定", createdAt: now.toISOString() },
    null,
    2
  );
}

/** GitHub のリポジトリの名前として使えるか（英数字・`.`・`-`・`_`。`.` で始まらない・`.git` で終わらない） */
export function repoNameProblem(name: string): string | undefined {
  const trimmed = name.trim();
  if (!trimmed) return "名前を入れてください";
  if (!/^[A-Za-z0-9._-]{1,100}$/.test(trimmed)) return "英数字と - _ . だけで入れてください（日本語は題のほうに）";
  if (trimmed.startsWith(".")) return "「.」で始まる名前は使えません";
  if (/\.git$/i.test(trimmed)) return "「.git」で終わる名前は使えません";
  return undefined;
}

export type CreateRepoResult = { kind: "created"; repo: GithubRepo } | { kind: "exists" } | { kind: "failed"; reason: ApiFailureKind };

/** GitHub に非公開のリポジトリを作る（合言葉は Authorization の頭にだけ） */
export async function createPrivateRepo(
  token: string,
  name: string,
  description: string,
  fetcher: (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ status: number; json(): Promise<unknown> }> = (url, init) =>
    fetch(url, init),
  apiBase = GITHUB_API
): Promise<CreateRepoResult> {
  let response: { status: number; json(): Promise<unknown> };
  try {
    response = await fetcher(`${apiBase}/user/repos`, {
      method: "POST",
      headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name, description, private: true, auto_init: true }),
    });
  } catch {
    return { kind: "failed", reason: "offline" };
  }
  // 同じ名前が自分のアカウントに在る
  if (response.status === 422) return { kind: "exists" };
  if (response.status !== 201) return { kind: "failed", reason: statusFailure(response.status) };
  const data = (await response.json()) as Record<string, unknown>;
  const owner = (data.owner as Record<string, unknown> | undefined)?.login;
  if (typeof owner !== "string" || typeof data.name !== "string" || data.private !== true) return { kind: "failed", reason: "unknown" };
  return {
    kind: "created",
    repo: { owner, name: data.name, private: true, defaultBranch: typeof data.default_branch === "string" ? data.default_branch : "main" },
  };
}

/** 本体の「本文起点」と同じ形を、取り寄せた作品の中に置く（在るファイルは書かない） */
export async function scaffoldNewWork(store: FileStore, root: string, title: string, now: Date = new Date()): Promise<void> {
  const encode = (text: string) => new TextEncoder().encode(text);
  await store.createDirectory(joinStorePath(root, ".aiwriter"));
  await store.createDirectory(joinStorePath(root, "本文"));
  await store.createDirectory(joinStorePath(root, "設定", "icons"));
  await store.writeFile(joinStorePath(root, ".aiwriter", "config.json"), encode(newWorkConfig(title, now)), { mode: "create" });
  await store.writeFile(joinStorePath(root, ".gitignore"), encode(newWorkGitignore()), { mode: "create" });
  // 第1話は空で作る（本体の `createFirstEpisodeFile`。番号3桁・.txt）
  await store.writeFile(joinStorePath(root, "本文", "001.txt"), new Uint8Array(), { mode: "create" });
}

export type NewWorkResult =
  | { kind: "created"; root: string }
  /** 端末に同じ名前のフォルダーがある（GitHub には何も作っていない） */
  | { kind: "local_exists" }
  /** GitHub に同じ名前のリポジトリがある（何も作っていない） */
  | { kind: "repo_exists" }
  | { kind: "bad_name"; problem: string }
  /** GitHub には作れたが、取り寄せか形を置くのに失敗した（リポジトリは GitHub に残る） */
  | { kind: "half"; repo: string; reason: ApiFailureKind | "scaffold" }
  | { kind: "failed"; reason: ApiFailureKind };

export async function createNewWork(input: {
  backend: GitFsBackend;
  store: FileStore;
  token: string;
  title: string;
  repoName: string;
  base?: string;
  now?: Date;
  createRepo?: typeof createPrivateRepo;
  clone?: CloneFn;
  fetcher?: Fetcher;
}): Promise<NewWorkResult> {
  const name = input.repoName.trim();
  const problem = repoNameProblem(name);
  if (problem) return { kind: "bad_name", problem };
  if (await input.backend.stat(`${input.base ?? ""}/${name}`)) return { kind: "local_exists" };
  const created = await (input.createRepo ?? createPrivateRepo)(input.token, name, input.title.trim());
  if (created.kind === "exists") return { kind: "repo_exists" };
  if (created.kind === "failed") return created;
  const imported = await importWork({
    backend: input.backend,
    repo: created.repo,
    token: input.token,
    ...(input.base !== undefined ? { base: input.base } : {}),
    ...(input.clone ? { clone: input.clone } : {}),
  });
  if (imported.kind !== "imported") {
    return { kind: "half", repo: `${created.repo.owner}/${created.repo.name}`, reason: imported.kind === "failed" ? imported.reason : "unknown" };
  }
  try {
    await scaffoldNewWork(input.store, imported.root, input.title.trim(), input.now);
  } catch {
    return { kind: "half", repo: `${created.repo.owner}/${created.repo.name}`, reason: "scaffold" };
  }
  return { kind: "created", root: imported.root };
}

export function newWorkResultText(result: Exclude<NewWorkResult, { kind: "created" }>): string {
  switch (result.kind) {
    case "local_exists":
      return "同じ名前の作品が、もう端末にあります。別の名前にしてください。";
    case "repo_exists":
      return "同じ名前のリポジトリが、もう GitHub にあります。別の名前にするか、［GitHub から取り寄せる］で取り寄せてください。";
    case "bad_name":
      return result.problem;
    case "half":
      return `GitHub に非公開のリポジトリ「${result.repo}」はできましたが、端末に置けませんでした。［GitHub から取り寄せる］で取り寄せ直せます。`;
    case "failed":
      return result.reason === "sign_in_again"
        ? "GitHub にサインインし直してください。"
        : result.reason === "offline"
          ? "ネットにつながってから、もう一度押してください。"
          : result.reason === "no_access"
            ? "リポジトリを作る権限がありません。サインインした GitHub のアカウントを確かめてください。"
            : "GitHub にリポジトリを作れませんでした。";
  }
}
