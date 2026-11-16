import type { FileStore } from "../platform/fileStore";
import { readTextFile } from "../platform/textFile";
import { createAutoSave, type AutoSave, type AutoSaveFailure, type AutoSaveStatus, type AutoSaveTimer, type VisibilitySource } from "./autoSave";
import { createDraftJournal, restoreDecision, type DraftJournal } from "./draftJournal";

/**
 * **話を開いて書くあいだの係**（原稿エディター C の土台。設計書 5.3 の4・5.4）。画面には触らない。
 *
 * 読む（`readTextFile`）・自動保存（`autoSave.ts`）・書きかけの控え（`draftJournal.ts`）を1つにまとめる。
 *
 * 守ること：
 *
 * - **開いただけでは何も書かない**。本文は読んだ字のまま（改行は LF、末尾の改行も残したまま）渡し、
 *   画面も同じ形で返す。形を変えると、開いたとたんに自動保存が原稿を書き直す
 * - 競合の印のある話は開かない（保存がいつも `conflict_markers` で止まる。直すのは同期の画面 G）
 * - 止められる前の控えがあり、保存してある本文と違えば、書きかけとして戻す。戻した書きかけは
 *   自動保存が書く。最初の保存なので退避を取る（戻した字が違っていても、開く前の本文は退避から戻せる）
 * - 控えを書いたあとで本文が変わっていたら（同期で入れ替わった・外で変わった）、戻すかを訊く
 *   （`confirmRestore`。同じなら黙って戻す。2026-11-16 作者の答え「本文が変わったときだけ訊く」）
 * - **控えを消すのは、保存が済んだ（「保存済み」になった）ときだけ**。「保存待ち」「外で変わりました」の
 *   あいだと、閉じたときに保存できていなければ控えを残す（次に開いたとき戻る）
 * - 裏に回ったら、保存と控えの両方をすぐ書く（`visibilitychange` と、端末のアプリの状態 `background`。
 *   どちらか一方が届かない端末があっても書く。設計書 5.4「アプリが裏に回るとき」）
 */

/** アプリが裏に回ったことを知らせる所（端末では Capacitor の `appStateChange`）。外す関数を返す */
export type BackgroundSource = (onBackground: () => void) => () => void;

export type OpenEpisodeResult =
  | { ok: true; session: EpisodeSession }
  | { ok: false; reason: "conflict_markers" | "unreadable"; detail?: string };

export interface EpisodeSession {
  readonly path: string;
  /** 画面に出す本文（戻した書きかけがあればそれ） */
  text(): string;
  /** 開いたときに控えから書きかけを戻したか */
  readonly restored: boolean;
  status(): AutoSaveStatus;
  /** 画面で打ったとき */
  edit(text: string): void;
  /** いま保存する（話を移るとき）。控えも書くか消す */
  flush(): Promise<AutoSaveStatus>;
  onStatusChange(listener: (status: AutoSaveStatus) => void): () => void;
  onFailure(listener: (failure: AutoSaveFailure) => void): () => void;
  /** 時計と聞き手を外す（保存しない。要るなら先に `flush()`）。控えは保存が済んでいなければ残す */
  dispose(): void;
}

export interface OpenEpisodeOptions {
  /** 裏に回ったことを知る所（既定は `document`） */
  visibility?: VisibilitySource;
  /** アプリが裏に回ったことを知る所（端末のアプリの状態）。在れば、裏に回ったとき保存と控えを書く */
  background?: BackgroundSource;
  /** 自動保存と控えの時計（テストで偽の時計に差し替える） */
  timer?: AutoSaveTimer;
  /** 控えを書けなかったとき（原稿は自動保存が書くので、知らせるだけ） */
  onJournalError?: (error: unknown) => void;
  /**
   * 控えを書いたあとで本文が変わっていたとき、書きかけを戻すか（true で戻す。false なら控えを消す）。
   * 無ければ戻す（字を失わない側）
   */
  confirmRestore?: () => Promise<boolean>;
  /** 原稿を書く直前に呼ぶ（アプリが書いた話の控え） */
  beforeWrite?: (path: string) => Promise<void>;
}

export async function openEpisode(store: FileStore, path: string, options: OpenEpisodeOptions = {}): Promise<OpenEpisodeResult> {
  let opened;
  try {
    opened = await readTextFile(store, path);
  } catch (error) {
    return { ok: false, reason: "unreadable", detail: error instanceof Error ? error.message : String(error) };
  }
  if (opened.hasConflictMarkers) return { ok: false, reason: "conflict_markers" };

  // 書きかけのもとになっている本文（開いたときは読んだ本文、保存が済むたびにその字）
  const base = { text: opened.text };
  const journal = createDraftJournal(store, path, {
    base: () => base.text,
    ...(options.timer ? { timer: options.timer } : {}),
    ...(options.onJournalError ? { onError: options.onJournalError } : {}),
  });
  let kept;
  try {
    kept = await journal.readEntry();
  } catch (error) {
    options.onJournalError?.(error);
  }
  const autoSave = createAutoSave({
    store,
    path,
    opened,
    ...(options.timer ? { timer: options.timer } : {}),
    ...(options.beforeWrite ? { beforeWrite: options.beforeWrite } : {}),
  });
  const decision = restoreDecision(kept, opened.text);
  const restored = decision === "restore" || (decision === "ask" && (options.confirmRestore ? await options.confirmRestore() : true));
  if (restored) autoSave.edit(kept!.text);
  else if (kept !== undefined) await journal.clear();
  return { ok: true, session: wrap(path, autoSave, journal, restored, base, options.visibility, options.background) };
}

function wrap(
  path: string,
  autoSave: AutoSave,
  journal: DraftJournal,
  restored: boolean,
  base: { text: string },
  visibility: VisibilitySource | undefined,
  background: BackgroundSource | undefined
): EpisodeSession {
  // 保存が済んだら控えは要らない（保存のあいだに打った字があれば「保存待ち」のままなので消さない）。
  // 置き場の本文はいまの字になったので、これからの控えのもとはこの字
  autoSave.onStatusChange((status) => {
    if (status !== "保存済み") return;
    base.text = autoSave.draft();
    void journal.clear();
  });
  const source = visibility ?? (globalThis.document as VisibilitySource | undefined);
  const detachAutoSave = autoSave.watchVisibility(source);
  const onHidden = (): void => {
    if (source?.visibilityState === "hidden" && autoSave.status() !== "保存済み") void journal.flush();
  };
  source?.addEventListener("visibilitychange", onHidden);

  const flush = async (): Promise<AutoSaveStatus> => {
    const status = await autoSave.flush();
    if (status === "保存済み") await journal.clear();
    else await journal.flush();
    return status;
  };
  const detachBackground = background?.(() => void flush());

  return {
    path,
    restored,
    text: () => autoSave.draft(),
    status: () => autoSave.status(),
    edit(text) {
      autoSave.edit(text);
      if (autoSave.status() === "保存済み") void journal.clear();
      else journal.note(text);
    },
    flush,
    onStatusChange: (listener) => autoSave.onStatusChange(listener),
    onFailure: (listener) => autoSave.onFailure(listener),
    dispose() {
      detachAutoSave();
      source?.removeEventListener("visibilitychange", onHidden);
      detachBackground?.();
      // 待っている控えは書いてから外す（保存できていない書きかけを失わない）
      if (autoSave.status() !== "保存済み") void journal.flush();
      autoSave.dispose();
    },
  };
}
