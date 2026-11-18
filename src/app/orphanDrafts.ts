import { FileNotFoundError, joinStorePath, type FileStore } from "../platform/fileStore";
import { toStorePath } from "../platform/paths";
import { findWorkRoots, scanWorkFolder } from "../platform/workScan";
import { JOURNAL_DIRECTORY, decodeJournal, journalPathFor } from "./draftJournal";
import { escapeHtml, renderAppBar } from "./menuScreen";
import { askChoice } from "./dialog";
import { DRAFT_PATH } from "./tategakiDraft";

/**
 * **どの話にも合わない書きかけの控え**（設定 → 書きかけの控え。2026-11-18 作者の答え「一覧にして、1つずつ消せる
 * ようにする（自動では消さない）」）。
 *
 * 控え（`draftJournal.ts`）の名前は話のパスのハッシュなので、話が消えたり名前が変わったりすると、控えだけが残り、
 * どの話の控えかはアプリにも分からない。いまある話（と縦書きの試し）のハッシュと合わない控えを、中身の頭と字数で
 * 並べ、作者が見て1つずつ消す。**自動では消さない**（同期で名前が変わった話の、保存していない書きかけかもしれない）。
 * 書いた日は出さない（置き場の読み書きの部品に日付を読む手が無い）
 */

export interface OrphanDraft {
  /** 控えの置き場のパス */
  file: string;
  /** 書きかけの字（控えの頭の行は除く） */
  text: string;
}

/** いまある話（と縦書きの試し）の控えのパス */
export async function knownJournalPaths(store: FileStore): Promise<Set<string>> {
  const known = new Set<string>([journalPathFor(DRAFT_PATH)]);
  for (const root of await findWorkRoots(store)) {
    try {
      for (const episode of (await scanWorkFolder(store, root)).episodes) {
        const path = toStorePath(episode.filePath);
        if (path) known.add(journalPathFor(path));
      }
    } catch {
      /* 読めない作品は飛ばす。その作品の控えは一覧に出るが、消すのは作者が見てから */
    }
  }
  return known;
}

/** どの話にも合わない控え（名前の順） */
export async function listOrphanDrafts(store: FileStore, known: ReadonlySet<string>): Promise<OrphanDraft[]> {
  let names: string[];
  try {
    names = await store.listFiles(JOURNAL_DIRECTORY);
  } catch (error) {
    if (error instanceof FileNotFoundError) return [];
    throw error;
  }
  const out: OrphanDraft[] = [];
  for (const name of [...names].sort()) {
    const file = joinStorePath(JOURNAL_DIRECTORY, name);
    if (known.has(file)) continue;
    try {
      out.push({ file, text: decodeJournal(new TextDecoder().decode(await store.readFile(file))).text });
    } catch {
      /* 読めない控えは並べない（消しもしない） */
    }
  }
  return out;
}

/** 中身の頭（空でない行から2行、60字まで） */
export function draftPreview(text: string): string {
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean).slice(0, 2).join("　");
  return lines.length > 60 ? `${lines.slice(0, 60)}…` : lines;
}

export function renderOrphanDrafts(list: readonly OrphanDraft[]): string {
  if (list.length === 0) return `<div class="work-empty" aria-hidden="true"></div>`;
  const rows = list
    .map(
      (draft) =>
        `<li class="orphan-draft" data-draft="${escapeHtml(draft.file)}"><p class="orphan-preview">${escapeHtml(draftPreview(draft.text) || "（空）")}</p>` +
        `<p class="orphan-count">${draft.text.length.toLocaleString("ja-JP")}字</p>` +
        `<button type="button" class="ghost" data-drop="${escapeHtml(draft.file)}">消す</button></li>`
    )
    .join("");
  return `<ol class="orphan-drafts">${rows}</ol>`;
}

/** 消すときに訊く文（作者のデータを消すので、中身の頭を見せて訊く） */
export function dropQuestion(draft: OrphanDraft): string {
  return `この書きかけを消します。元に戻せません。\n\n${draftPreview(draft.text) || "（空）"}`;
}

export function mountOrphanDrafts(screen: HTMLElement, store: FileStore, stillHere: () => boolean, toast: (text: string) => void): void {
  screen.innerHTML = `${renderAppBar("書きかけの控え", { back: true })}<div id="orphanSlot" aria-busy="true"></div>`;
  const slot = screen.querySelector<HTMLElement>("#orphanSlot")!;
  let list: OrphanDraft[] = [];
  const show = () => {
    slot.removeAttribute("aria-busy");
    slot.innerHTML = renderOrphanDrafts(list);
  };
  void (async () => {
    try {
      list = await listOrphanDrafts(store, await knownJournalPaths(store));
    } catch (error) {
      if (stillHere()) slot.innerHTML = `<p class="flag shu long">${escapeHtml(error instanceof Error ? error.message : String(error))}</p>`;
      return;
    }
    if (stillHere()) show();
  })();
  slot.addEventListener("click", (event) => {
    const file = (event.target as HTMLElement).closest<HTMLElement>("[data-drop]")?.dataset.drop;
    const draft = list.find((item) => item.file === file);
    if (!draft) return;
    void (async () => {
      if (!(await askChoice(dropQuestion(draft), "消す", "やめる"))) return;
      try {
        await store.deleteFile(draft.file);
      } catch (error) {
        if (!(error instanceof FileNotFoundError)) return toast("消せませんでした");
      }
      list = list.filter((item) => item.file !== draft.file);
      if (stillHere()) show();
      toast("消しました");
    })();
  });
}
