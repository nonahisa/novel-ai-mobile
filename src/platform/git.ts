import "./bufferShim";
import git from "isomorphic-git";
import { CapacitorGitFsBackend, createGitFs, type GitFsBackend } from "./gitFs";
import { gitHttp } from "./gitHttp";

/**
 * 端末の git（段0の試作。設計書 6章）。
 *
 * 本体の `core/git.ts` は git のコマンドを呼ぶ作りで、端末にはコマンドが無い。
 * ここでは isomorphic-git で「公開のリポジトリを取ってくる」ところまでを試す。
 * 本体の `core/git.ts` と同じ名前の関数を揃えるか（差し替えの形）は、この試作の結果で決める。
 */

export interface ShallowCloneResult {
  /** 取ってきた版 */
  head: string;
  /** その版の題 */
  message: string;
  /** 作業の木に出したファイルの数 */
  fileCount: number;
  /** かかった時間（ミリ秒） */
  elapsedMs: number;
}

/**
 * 浅く取ってくる（最新の1版だけ。設計書 段1「初めは浅い取得」）。
 * `dir` は `/` で始まる場所（`works` の下）。
 */
export async function shallowClone(
  url: string,
  dir: string,
  backend: GitFsBackend = new CapacitorGitFsBackend(),
  onProgress?: (phase: string, loaded: number, total?: number) => void
): Promise<ShallowCloneResult> {
  const startedAt = Date.now();
  const fs = createGitFs(backend);
  await git.clone({
    fs,
    http: await gitHttp(),
    dir,
    url,
    depth: 1,
    singleBranch: true,
    onProgress: (event) => onProgress?.(event.phase, event.loaded, event.total),
  });
  const [latest] = await git.log({ fs, dir, depth: 1 });
  const files = await git.listFiles({ fs, dir });
  return {
    head: latest.oid,
    message: latest.commit.message.trim(),
    fileCount: files.length,
    elapsedMs: Date.now() - startedAt,
  };
}

/** フォルダーを中身ごと消す（試作をやり直すため） */
export async function removeTree(backend: GitFsBackend, dir: string): Promise<void> {
  const stat = await backend.stat(dir);
  if (!stat) return;
  if (stat.type === "file") return backend.unlink(dir);
  for (const name of await backend.readdir(dir)) await removeTree(backend, `${dir}/${name}`);
  await backend.rmdir(dir);
}
