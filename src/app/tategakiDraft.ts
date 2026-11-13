import { INTERNAL_EMPHASIS_SOURCE, INTERNAL_RUBY_SOURCE, countChars, formatCount, rubyToHtml } from "../shared";
import { FileNotFoundError, type FileStore } from "../platform/fileStore";
import {
  encodeForNewFile,
  readTextFile,
  writeTextFilePreservingFormat,
  type TextFileContent,
  type WriteTextFailureReason,
} from "../platform/textFile";

/**
 * 縦書きの試し（作者の頼み 2026-11-07「縦書きの試しを作成してください」）の中身。
 * 画面は `tategakiScreen.ts`。ここはテストできる所だけを置く。
 *
 * - ルビ・傍点の表示は本体の記法（`{漢字|かんじ}`・`{{語}}`）と本体の `rubyToHtml`
 * - 字数は本体の `countChars`（改行を除く。ルビの読みは数えない。投稿サイトと同じ）
 * - 保存は**本体の決まりで書き戻す**：2回目からは `writeTextFilePreservingFormat`
 *   （読んだときのハッシュと照らし、文字コードと改行を保ち、退避の写しを残す）。
 *   はじめての保存だけ、UTF-8・LF で新しく作る（`create`。在れば上書きしない）
 */

/** 試しの原稿の置き場（アプリの置き場の中。作品の置き場とは分ける） */
export const DRAFT_PATH = "試し/縦書き.txt";

/** はじめての保存の形 */
const NEW_FILE_FORMAT: Pick<TextFileContent, "encoding" | "eol" | "hasTrailingNewline"> = {
  encoding: "utf8",
  eol: "\n",
  hasTrailingNewline: true,
};

/** 初めて開いたときの見本 */
export const SAMPLE_TEXT =
  "{吾輩|わがはい}は猫である。名前はまだ無い。\nどこで生れたか{{頓と}}見当がつかぬ。\n\n" +
  "ここに続きを書いてみてください。ルビは {漢字|かんじ}、傍点は {{語}} と打ちます。";

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/**
 * 表示用の HTML。ルビと傍点は本体の `rubyToHtml` に任せ、**それ以外の地の文はここで escape する**
 * （`rubyToHtml` はルビ以外をそのまま返すので、地の文の `<` がタグになってしまう）。
 * 傍点を先に当てる（`{{語}}` がルビの形に読まれないように。本体と同じ順）。
 */
export function previewHtml(text: string): string {
  const notation = new RegExp(`${INTERNAL_EMPHASIS_SOURCE}|${INTERNAL_RUBY_SOURCE}`, "g");
  let html = "";
  let last = 0;
  for (const match of text.matchAll(notation)) {
    html += escapeHtml(text.slice(last, match.index));
    html += rubyToHtml(match[0]);
    last = match.index + match[0].length;
  }
  html += escapeHtml(text.slice(last));
  return html.replace(/\r?\n/g, "<br>");
}

/** 字数の表示（本体と同じ数え方） */
export function countLabel(text: string): string {
  const counts = countChars(text);
  return `${formatCount(counts.gross)} 字（空白を除くと ${formatCount(counts.net)} 字）`;
}

/** 置き場から読む。まだ無ければ undefined */
export async function loadDraft(store: FileStore): Promise<TextFileContent | undefined> {
  try {
    return await readTextFile(store, DRAFT_PATH);
  } catch (error) {
    if (error instanceof FileNotFoundError) return undefined;
    throw error;
  }
}

export type SaveDraftResult =
  | {
      ok: true;
      /** 読み戻した中身（次の保存で使う。ハッシュが新しくなる） */
      readBack: TextFileContent;
      /** 書いたつもりの本文と、読み戻した本文が同じか */
      same: boolean;
      /** 前の中身の退避の写し（2回目からの保存だけ） */
      recoveryPath?: string;
      created: boolean;
    }
  | { ok: false; reason: WriteTextFailureReason | "cannot_encode"; detail?: string };

/** 改行を LF にそろえ、末尾の改行の有無を書き方に合わせた形（読み戻しと比べるため） */
function expectedText(text: string, hasTrailingNewline: boolean): string {
  const lf = text.replace(/\r\n?/g, "\n");
  return hasTrailingNewline ? (lf.endsWith("\n") ? lf : `${lf}\n`) : lf.replace(/\n+$/, "");
}

/**
 * 保存して読み戻す。`loaded` は前に読んだ（か保存した）中身。
 * 外で書き換えられていたら書かない（`modified_externally`）。
 */
export async function saveDraft(store: FileStore, text: string, loaded: TextFileContent | undefined): Promise<SaveDraftResult> {
  let recoveryPath: string | undefined;
  let created = false;
  if (loaded) {
    const result = await writeTextFilePreservingFormat(store, DRAFT_PATH, text, loaded, loaded.hash);
    if (!result.ok) return { ok: false, reason: result.reason, detail: result.detail };
    recoveryPath = result.recoveryPath;
  } else {
    const bytes = encodeForNewFile(text, NEW_FILE_FORMAT);
    if (!bytes) return { ok: false, reason: "cannot_encode" };
    await store.createDirectory("試し");
    try {
      await store.writeFile(DRAFT_PATH, bytes, { mode: "create" });
    } catch {
      // 読んでいない間に在った（別の画面で作られた等）。黙って上書きしない
      return { ok: false, reason: "modified_externally" };
    }
    created = true;
  }
  const readBack = await readTextFile(store, DRAFT_PATH);
  const hasTrailingNewline = (loaded ?? NEW_FILE_FORMAT).hasTrailingNewline;
  const same = readBack.text.replace(/\r\n?/g, "\n") === expectedText(text, hasTrailingNewline);
  return { ok: true, readBack, same, recoveryPath, created };
}

/** 保存の失敗を作者へ出す文（種類ごとに次の操作を1つ） */
export function saveFailureMessage(reason: WriteTextFailureReason | "cannot_encode"): string {
  switch (reason) {
    case "modified_externally":
      return "読んだあとで、ほかの所から書き換えられていました。上書きしないで止めました。［読み直す］を押してから、もう一度保存してください。";
    case "conflict_markers":
      return "本文に、git の食い違いの印（<<<<<<< など）が入っています。印を消してから保存してください。";
    case "encoding_error":
    case "cannot_encode":
      return "この文字コードで表せない字があります。その字を直してから保存してください。";
    case "path_conflict":
      return "置き場の名前がほかのものと重なっています。保存を止めました。";
  }
}

/**
 * **試しの画面の選び方を覚える**（2026-11-07 Mac：試しへ入り直すと A に戻り、B を選んでいたことを
 * 覚えていなかった）。向き・A／B／C・B の受け口を、端末の中（localStorage）に置く。
 * 読めない・壊れている・この端末で使えない受け口（EditContext が無い）なら、初めの形に戻す。
 */
export interface TrialPrefs {
  orientation: "vertical" | "horizontal";
  mode: "A" | "B" | "C";
  sinkKind: "ec" | "sink";
}

export const TRIAL_PREFS_KEY = "novelai.tategakiTrial";

export function parseTrialPrefs(raw: string | null, editContextOk: boolean): TrialPrefs {
  const fallback: TrialPrefs = { orientation: "vertical", mode: "A", sinkKind: editContextOk ? "ec" : "sink" };
  if (!raw) return fallback;
  try {
    const value = JSON.parse(raw) as Partial<Record<keyof TrialPrefs, unknown>>;
    const orientation = value.orientation === "horizontal" || value.orientation === "vertical" ? value.orientation : fallback.orientation;
    const mode = value.mode === "A" || value.mode === "B" || value.mode === "C" ? value.mode : fallback.mode;
    const sinkKind = value.sinkKind === "sink" ? "sink" : value.sinkKind === "ec" && editContextOk ? "ec" : fallback.sinkKind;
    return { orientation, mode, sinkKind };
  } catch {
    return fallback;
  }
}
