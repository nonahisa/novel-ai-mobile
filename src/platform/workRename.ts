import { AIWRITER_DIR, CONFIG_FILE, CONFIG_SCHEMA_VERSION, detectJsonFileFormat, formatJsonForFile } from "../shared";
import { FileExistsError, FileNotFoundError, joinStorePath, type FileStore } from "./fileStore";
import { readTextFile, writeTextFilePreservingFormat } from "./textFile";
import { readWorkLayout } from "./workScan";
import { ledgerShapeProblem } from "./ledgerShapeGate";

/**
 * **作品の題を変える**（作品の長押し → 題を変える。設計書 4.4.1。本体の `features/renameWork.ts` と同じ考え）。
 *
 * 題は2か所にある（本体はほかに登録の帳面にもあるが、モバイル版には無い）：
 * 1. 作品の設定ファイル（`.aiwriter/config.json` の `workTitle`）。モバイル版の作品の一覧はここから読む
 * 2. プロット（`設定/plot.md`）の先頭の `# 〈題〉`——**作者の文書**。元の題と同じときだけ変える（自分で書き換えた見出しは触らない）
 *
 * **フォルダー名は変えない**（GitHub の同期先・書庫の並びが切れる。本体と同じ）。
 *
 * 【決定】2026-11-18 作者の答え：**設定ファイルが無い作品では、題を変えるときに設定ファイルを作る**（本体は作らないが、
 * モバイル版には登録の帳面が無く、題の置き場がここしか無いため）。作るのは題だけ（`schemaVersion`・`workTitle`）で、本文と設定の
 * 置き場は書かない（書くと既定の置き場で固定される。本体の心配）。「無いときだけ作る」で作り、そのあいだに外でできていたら上書きしない。
 * 書き換えは `writeTextFilePreservingFormat`（ハッシュの照らし合わせ・**元を退避**・改行の形を保つ）。ほかの欄は変えない。
 * 壊れた設定ファイルは直さずに止める
 */

export type RenameOutcome =
  | { kind: "renamed"; notes: string[] }
  | { kind: "unchanged" }
  | { kind: "failed"; message: string };

/** 設定ファイルを新しく作るときの形（本体の `NEW_CONFIG_FORMAT`：LF・末尾に改行なし） */
const NEW_CONFIG_FORMAT = { useCrlf: false, finalNewline: false } as const;

export async function renameWork(store: FileStore, root: string, rawTitle: string): Promise<RenameOutcome> {
  const newTitle = rawTitle.trim();
  if (!newTitle) return { kind: "failed", message: "題を入れてください" };
  let layout;
  try {
    layout = await readWorkLayout(store, root);
  } catch (error) {
    // 壊れた設定ファイルは直さない（本体の決まり2）
    return { kind: "failed", message: error instanceof Error ? error.message : String(error) };
  }
  const oldTitle = layout.title;
  if (newTitle === oldTitle) return { kind: "unchanged" };

  const configPath = joinStorePath(root, AIWRITER_DIR, CONFIG_FILE);
  let existing;
  try {
    existing = await readTextFile(store, configPath);
  } catch (error) {
    if (!(error instanceof FileNotFoundError)) return { kind: "failed", message: "作品の設定ファイルを読めませんでした" };
  }
  if (existing) {
    // モバイル版の知らない新しい形なら書かない（2026-11-21 作者の答え「台帳の形が変わったときだけ止める」）
    const newer = ledgerShapeProblem("作品の設定", existing.text, CONFIG_SCHEMA_VERSION);
    if (newer) return { kind: "failed", message: newer };
    const value = JSON.parse(existing.text) as Record<string, unknown>;
    const text = formatJsonForFile({ ...value, workTitle: newTitle }, detectJsonFileFormat(await store.readFile(configPath)));
    const written = await writeTextFilePreservingFormat(store, configPath, text, existing, existing.hash);
    if (!written.ok) {
      return {
        kind: "failed",
        message: written.reason === "modified_externally" ? "読んだあとで作品の設定ファイルが変わったので、題を変えませんでした" : "作品の設定ファイルに書けませんでした",
      };
    }
  } else {
    try {
      await store.createDirectory(joinStorePath(root, AIWRITER_DIR));
      await store.writeFile(configPath, new TextEncoder().encode(formatJsonForFile({ schemaVersion: "0.1", workTitle: newTitle }, NEW_CONFIG_FORMAT)), { mode: "create" });
    } catch (error) {
      return {
        kind: "failed",
        message: error instanceof FileExistsError ? "作品の設定ファイルが外でできたので、題を変えませんでした" : "作品の設定ファイルを作れませんでした",
      };
    }
  }

  // プロットの先頭の見出し（無い作品のほうが多い。無いことは断りにしない）
  const notes: string[] = [];
  const plotPath = joinStorePath(layout.settings, "plot.md");
  try {
    const plot = await readTextFile(store, plotPath);
    const renamed = renamePlotHeading(plot.text, oldTitle, newTitle);
    if (!renamed.changed) {
      if (/^#(?!#)[ \t]+/m.test(plot.text)) notes.push("プロットの見出しは元の題と違ったので変えていません");
    } else {
      const written = await writeTextFilePreservingFormat(store, plotPath, renamed.text.replace(/\r\n?/g, "\n"), plot, plot.hash);
      if (!written.ok) notes.push("プロットの見出しは書き換えられませんでした");
    }
  } catch (error) {
    if (!(error instanceof FileNotFoundError)) notes.push("プロットの見出しは書き換えられませんでした");
  }
  return { kind: "renamed", notes };
}

/**
 * プロットの最初の `# 見出し` が元の題と同じなら、新しい題に替える（本体の `core/plotDoc.ts` の `renamePlotHeading` と同じ。
 * 本体のものは vscode に頼る部品の中にあるので写す）。`##` は作者が並べた節なので題と読み違えない。最初の `# ` 見出しだけを見る
 */
export function renamePlotHeading(text: string, oldTitle: string, newTitle: string): { text: string; changed: boolean } {
  const parts = text.split(/(\r\n|\n|\r)/);
  const wanted = oldTitle.trim();
  for (let i = 0; i < parts.length; i += 2) {
    const heading = /^#(?!#)[ \t]+(.*)$/.exec(parts[i]!);
    if (!heading) continue;
    if (wanted.length === 0 || heading[1]!.trim() !== wanted) return { text, changed: false };
    parts[i] = `# ${newTitle}`;
    return { text: parts.join(""), changed: true };
  }
  return { text, changed: false };
}
