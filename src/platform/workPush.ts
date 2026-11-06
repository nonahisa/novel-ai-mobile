import "./bufferShim";
import git from "isomorphic-git";
import {
  pushViaGitHubApi,
  type ApiFetch,
  type CommitIdentity,
  type FileChange,
  type PushResult,
  type RepoRef,
} from "./githubCommitApi";
import { gitHttp } from "./gitHttp";
import type { createGitFs } from "./gitFs";

/**
 * 手元の作品（isomorphic-git のリポジトリ）を、GitHub の API で送る（原稿を持ち帰る道 A。引継ぎ書 11章）。
 *
 * 1. 変わった話を集める（`collectChanges`）。手元の HEAD（＝最後に向こうとそろえた版）と作業の木を比べる
 * 2. 索引に足し、手元の git で木の名前を数える（版は作るが枝は動かさない。`noUpdateBranch`）
 * 3. `pushViaGitHubApi` で送る。中身と木の名前は手元と照らされる
 * 4. 送れたら、向こうの版を手元へ取り込み（`adopt`。ふつうは git の取得）、手元の枝をその版に合わせる。
 *    木が同じなので、作業の木と索引はそのまま
 *
 * ## isomorphic-git の見落としに備える
 *
 * isomorphic-git は「変わったか」を大きさと時刻（秒まで）で先に見る。同じ秒に同じ大きさで
 * 書き換えると見落とす（`test/git.test.ts` の【限界】）。だから**アプリが書いた話は `touched` で名指しし**、
 * 中身を読んで HEAD の中身の名前と比べる。
 *
 * 向こうが先へ進んでいた（`behind`）ときは、何も動かさずに返す。受け取って見比べるのは
 * 食い違いの扱い（まだ作っていない）。
 */

/** isomorphic-git の `fs` の形（`createGitFs` が返すもの） */
type GitFs = ReturnType<typeof createGitFs>;

/** 手元の HEAD の版と、その中の道の中身の名前（無ければ undefined） */
async function headBlobOid(fs: GitFs, dir: string, head: string, filepath: string): Promise<string | undefined> {
  try {
    return (await git.readBlob({ fs, dir, oid: head, filepath })).oid;
  } catch {
    return undefined;
  }
}

async function exists(fs: GitFs, path: string): Promise<boolean> {
  try {
    await fs.promises.stat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * 手元の HEAD から変わった話を集める。中身は作業の木から読み、名前（`oid`）も数えて添える。
 * `touched` はアプリが書いた道（isomorphic-git が見落としても拾う）。
 */
export async function collectChanges(fs: GitFs, dir: string, touched: readonly string[] = []): Promise<FileChange[]> {
  const head = await git.resolveRef({ fs, dir, ref: "HEAD" });
  const matrix = await git.statusMatrix({ fs, dir });
  const candidates = new Set<string>();
  for (const [path, headState, workdirState] of matrix) {
    // 1 と 2 の違い＝書き換え、0 と 2＝新しい話、1 と 0＝消した話
    if (headState !== workdirState) candidates.add(path);
  }
  for (const path of touched) candidates.add(path);

  const changes: FileChange[] = [];
  for (const path of [...candidates].sort()) {
    const before = await headBlobOid(fs, dir, head, path);
    if (!(await exists(fs, `${dir}/${path}`))) {
      if (before) changes.push({ path, deleted: true });
      continue;
    }
    const bytes = new Uint8Array((await fs.promises.readFile(`${dir}/${path}`)) as Uint8Array);
    const { oid } = await git.hashBlob({ object: bytes });
    if (oid !== before) changes.push({ path, bytes, oid });
  }
  return changes;
}

export interface WorkPushInput extends RepoRef {
  fs: GitFs;
  dir: string;
  token: string;
  message: string;
  author: CommitIdentity;
  /** アプリが書いた道 */
  touched?: readonly string[];
  /** 送れた版を手元へ取り込む（省けば git の取得）。テストで替える */
  adopt?: (commit: string) => Promise<void>;
  fetcher?: ApiFetch;
  apiBase?: string;
}

export type WorkPushResult =
  | (PushResult & { kind: "nothing_to_push" | "behind" | "failed" })
  /** 送れた。`adopted` が false なら、手元の枝はまだ前の版（次の同期で取り込む） */
  | { kind: "pushed"; commit: string; tree: string; adopted: boolean };

/** 既定の取り込み：GitHub から浅く取得する（端末の通信の口。取得は文字の本文だけで足りる） */
function fetchAdopt(input: WorkPushInput): (commit: string) => Promise<void> {
  return async () => {
    await git.fetch({
      fs: input.fs,
      http: await gitHttp(),
      dir: input.dir,
      url: `https://github.com/${input.owner}/${input.repo}.git`,
      ref: input.branch,
      singleBranch: true,
      depth: 1,
      onAuth: () => ({ username: "x-access-token", password: input.token }),
    });
  };
}

async function hasCommit(fs: GitFs, dir: string, oid: string): Promise<boolean> {
  try {
    await git.readCommit({ fs, dir, oid });
    return true;
  } catch {
    return false;
  }
}

/** 手元の作品を送る */
export async function pushWork(input: WorkPushInput): Promise<WorkPushResult> {
  const { fs, dir } = input;
  const changes = await collectChanges(fs, dir, input.touched ?? []);
  if (changes.length === 0) return { kind: "nothing_to_push" };

  const baseCommit = await git.resolveRef({ fs, dir, ref: "HEAD" });
  const baseTree = (await git.readCommit({ fs, dir, oid: baseCommit })).commit.tree;

  // 索引に足して、手元の git で木の名前を数える（枝は動かさない）
  for (const change of changes) {
    if ("deleted" in change) await git.remove({ fs, dir, filepath: change.path });
    else await git.add({ fs, dir, filepath: change.path });
  }
  const local = await git.commit({
    fs,
    dir,
    message: input.message,
    author: { name: input.author.name, email: input.author.email },
    noUpdateBranch: true,
  });
  const expectedTree = (await git.readCommit({ fs, dir, oid: local })).commit.tree;

  const result = await pushViaGitHubApi(
    {
      owner: input.owner,
      repo: input.repo,
      branch: input.branch,
      token: input.token,
      baseCommit,
      baseTree,
      changes,
      message: input.message,
      author: input.author,
      expectedTree,
    },
    input.fetcher,
    input.apiBase
  );
  if (result.kind !== "pushed") return result;

  // 向こうの版を取り込み、手元の枝をそれに合わせる
  try {
    await (input.adopt ?? fetchAdopt(input))(result.commit);
  } catch {
    return { ...result, adopted: false };
  }
  if (!(await hasCommit(fs, dir, result.commit))) return { ...result, adopted: false };
  const adoptedTree = (await git.readCommit({ fs, dir, oid: result.commit })).commit.tree;
  if (adoptedTree !== expectedTree) return { ...result, adopted: false };
  await git.writeRef({ fs, dir, ref: `refs/heads/${input.branch}`, value: result.commit, force: true });
  await git.writeRef({ fs, dir, ref: `refs/remotes/origin/${input.branch}`, value: result.commit, force: true });
  return { ...result, adopted: true };
}
