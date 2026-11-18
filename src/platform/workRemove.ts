import { journalPathFor } from "../app/draftJournal";
import { toStorePath } from "./paths";
import type { FileStore } from "./fileStore";
import { removeTree } from "./git";
import { createGitFs, type GitFsBackend } from "./gitFs";
import { readWorkSync } from "./workSync";
import { scanWorkFolder } from "./workScan";

/**
 * **作品をこの端末から外す**（作品の長押し → 登録から外す。設計書 4.4.1「外しても、GitHub の置き場は消さない」）。
 *
 * モバイル版には登録の帳面が無いので、外すと**端末の中の作品のフォルダーを消す**ことになる。作者のデータを消すので、
 * 【決定】2026-11-18 作者の答え「GitHub へ送っていないものがあれば外さない」に沿って、次のどれかなら外さない：
 * - GitHub と結んでいない作品（git の置き場が無い）。外すと、どこにも残らない
 * - 送っていない話・送っていない変更がある
 * - 保存していない書きかけ（話の控え。`.novelai-drafts/`）がある
 * - 書庫の中の作品（1つのリポジトリに何作品か）。フォルダーを消すと、それ自体が送っていない変更になる
 * 外せるときは、確かめの窓（呼ぶ側）のあとでリポジトリのフォルダーごと消す。GitHub の置き場は触らない（取り寄せ直せる）
 */

type GitFs = ReturnType<typeof createGitFs>;

export type RemoveCheck = { ok: true } | { ok: false; reason: string };

export async function checkRemovable(store: FileStore, fs: GitFs, root: string, base = ""): Promise<RemoveCheck> {
  if (root.includes("/")) return { ok: false, reason: "書庫の中の作品は外せません（外すと、それが送っていない変更になります）" };
  const state = await readWorkSync(fs, root, base).catch(() => undefined);
  if (!state) return { ok: false, reason: "GitHub と結んでいない作品なので外せません（外すと、どこにも残りません）" };
  if (state.unsent.length > 0) return { ok: false, reason: `送っていない話が ${state.unsent.length} 話あるので外せません。先に送ってください` };
  if (state.otherCount > 0) return { ok: false, reason: `送っていない変更が ${state.otherCount} つあるので外せません。先に送ってください` };
  try {
    for (const episode of (await scanWorkFolder(store, root)).episodes) {
      const path = toStorePath(episode.filePath);
      if (!path) continue;
      try {
        await store.readFile(journalPathFor(path));
        return { ok: false, reason: "保存していない書きかけがある話があるので外せません。その話を開いて保存してください" };
      } catch {
        /* 控えが無い（ふつう） */
      }
    }
  } catch {
    return { ok: false, reason: "作品を読めないので外せません" };
  }
  return { ok: true };
}

/** 外す（確かめてから呼ぶ）。リポジトリのフォルダーごと消す */
export async function removeWorkFolder(backend: GitFsBackend, root: string, base = ""): Promise<void> {
  await removeTree(backend, `${base}/${root}`);
}
