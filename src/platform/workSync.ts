import "./bufferShim";
import git from "isomorphic-git";
import type { createGitFs } from "./gitFs";
import { collectChanges } from "./workPush";
import { readTouched } from "./touchedPaths";
import { isBaselineOnlyStatsChange, isStatsFilePath } from "./writingStatsRecord";

/**
 * **作品の同期の状態**（設計書 6章「作品一覧と話の一覧に『送っていない話』の数を出す」。画面 A・B）。
 * 通信しない。手元の git の HEAD（最後に向こうとそろえた版）と作業の木を比べるだけ。
 *
 * - git のリポジトリは置き場の直下のフォルダー。書庫の中の作品（`書庫/作品`）は書庫が1つのリポジトリなので、
 *   その作品のフォルダーの中の変更だけを数える（ほかの作品の変更を混ぜない）
 * - 比べ方は送るとき（`collectChanges`）と同じ。大きさと時刻で拾い、中身の名前で確かめる
 * - git で持っていない作品（`.git` が無い）は `undefined`（同期の状態を出さない）
 * - 「送っていない話」は原稿（`.txt`）だけを数える。設定などの変更は `otherCount`
 * - 中身の競合の印（`hasConflictMarkers`）とは別のもの。こちらは送っていない変更
 * - 字数の記録（`.aiwriter/stats/*.json`）の、基準を置き直しただけの変更は数えない（2026-11-20 夜 作者の答え
 *   「基準も記録のファイルに」。取り込むたびに基準が変わるので、数えると取り込みのたびに「送っていない変更」が出る）。
 *   日ごとの字数が変わった記録は数える（書いた話と一緒に送る）
 * - 書き戻しの退避（`.novelai-recovery/`）は数えない。端末の中だけの写しで、作者が書き換えたものではない
 *   （ふつうは作品の `.gitignore` で外れるが、外していない作品でも。`collectChanges` が外す）
 */

type GitFs = ReturnType<typeof createGitFs>;

export interface UnsentFile {
  /** 置き場の根からの道（`作品/本文/第1話.txt`） */
  path: string;
  deleted: boolean;
  /** 書いた時刻（消した話は無し） */
  mtimeMs?: number;
}

export interface WorkSyncState {
  /** 送っていない話（原稿） */
  unsent: UnsentFile[];
  /** 原稿のほかの、送っていない変更の数（設定・章立てなど） */
  otherCount: number;
}

/** 作品のリポジトリと、その中の作品のフォルダー（`base` は git の置き場の根。端末では空） */
export function workRepo(root: string, base = ""): { dir: string; prefix: string } {
  const [repo, ...rest] = root.split("/");
  return { dir: `${base}/${repo}`, prefix: rest.length > 0 ? `${rest.join("/")}/` : "" };
}

const isStory = (path: string) => /\.txt$/i.test(path);

export async function readWorkSync(fs: GitFs, root: string, base = ""): Promise<WorkSyncState | undefined> {
  const { dir, prefix } = workRepo(root, base);
  try {
    await git.resolveRef({ fs, dir, ref: "HEAD" });
  } catch {
    return undefined;
  }
  // アプリが書いた話は名指しする（同じ秒・同じ大きさの書き換えを見落とさない。touchedPaths.ts）
  const changes = await collectChanges(fs, dir, await readTouched(fs, dir), prefix ? (path) => path.startsWith(prefix) : undefined);
  const repoName = dir.slice(base.length + 1);
  const unsent: UnsentFile[] = [];
  let otherCount = 0;
  for (const change of changes) {
    if (!isStory(change.path)) {
      if (!("deleted" in change && change.deleted) && (await isBaselineOnlyChange(fs, dir, change.path))) continue;
      otherCount += 1;
      continue;
    }
    const path = `${repoName}/${change.path}`;
    if ("deleted" in change && change.deleted) {
      unsent.push({ path, deleted: true });
      continue;
    }
    let mtimeMs: number | undefined;
    try {
      mtimeMs = (await fs.promises.stat(`${dir}/${change.path}`)).mtimeMs;
    } catch {
      mtimeMs = undefined;
    }
    unsent.push({ path, deleted: false, ...(mtimeMs !== undefined ? { mtimeMs } : {}) });
  }
  return { unsent, otherCount };
}

/**
 * 作業の木のこのファイルの変更が、字数の記録の基準を置き直しただけか（最後にそろえた版〈HEAD〉の中身と比べる）。
 * 記録のファイルでなければ false
 */
export async function isBaselineOnlyChange(fs: GitFs, dir: string, path: string): Promise<boolean> {
  if (!isStatsFilePath(path)) return false;
  let after: string;
  try {
    after = (await fs.promises.readFile(`${dir}/${path}`, "utf8")) as string;
  } catch {
    return false;
  }
  let before: string | undefined;
  try {
    const head = await git.resolveRef({ fs, dir, ref: "HEAD" });
    const { blob } = await git.readBlob({ fs, dir, oid: head, filepath: path });
    before = new TextDecoder().decode(blob);
  } catch {
    before = undefined;
  }
  return isBaselineOnlyStatsChange(before, after);
}

/** 送っていない話のうち、いちばん新しく書いた時刻（作者の答え 2026-11-16：「最後に書いた日」はこれにする） */
export function latestUnsentTime(state: WorkSyncState | undefined): number | undefined {
  const times = (state?.unsent ?? []).map((file) => file.mtimeMs).filter((t): t is number => t !== undefined);
  return times.length > 0 ? Math.max(...times) : undefined;
}
