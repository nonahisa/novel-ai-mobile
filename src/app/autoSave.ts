import type { FileStore } from "../platform/fileStore";
import {
  writeTextFilePreservingFormat,
  type TextFileContent,
  type WriteTextFailureReason,
} from "../platform/textFile";

/**
 * 自動保存の係（設計書 5.4「保存」。2026-10-31 作者「案どおり」）。
 *
 * 拡張機能は保存を VS Code に任せていた。Android は裏に回したアプリを予告なく止めるので、
 * 「保存していない書きかけ」を長く持たない。次の3つのときに保存する：
 *
 * - 打つのを止めて2秒たったとき（`edit` のたびに時計を回し直す）
 * - 話を移るとき（呼ぶ側が `flush()` を待ってから移る）
 * - アプリが裏に回るとき（`watchVisibility` が `document` の `visibilitychange` を受ける。
 *   Capacitor の `appStateChange` は呼ぶ側で
 *   `App.addListener("appStateChange", ({ isActive }) => { if (!isActive) void autoSave.flush(); })` と足す）
 *
 * 守ること：
 *
 * - 保存は必ず `writeTextFilePreservingFormat` を通す（ハッシュの確かめ・競合の印・文字コードと改行の保持）
 * - **退避は話を開いて最初の保存のときだけ**。2回目からは `skipRecovery`（2秒ごとに退避すると、
 *   開く前の本文が5回で押し出される）。最初の保存が失敗したら、次の保存でまた退避する
 * - 保存が済んだら、返ってきたハッシュを次の保存の `expectedHash` に使う
 * - 保存は1つずつ。重ねて呼ばれたら前の保存が済むのを待つ（同じハッシュで2つ書くと、2つめが
 *   1つめの保存を「外で変わった」と取り違え、自動保存が止まる）
 * - 外で変わった（`modified_externally`）ら書かずに止め、書きかけを残したまま「外で変わりました」にする。
 *   **上書きの道は作らない**。以後の自動保存も止める（作者が［あちらを見る］などを選ぶ。画面はまだ無い）
 * - ほかの失敗（Shift_JIS で書けない字・競合の印・置き場の失敗）は「保存待ち」のまま書きかけを残し、
 *   `lastFailure()` で理由を見せる。次に打ったとき・`flush()` のときにまた試す（続けて試し続けない）
 * - **ほかの失敗は、その場で真ん中の窓で知らせる**（2026-11-15 作者の答え。上のバーではない）。
 *   `onFailure` の聞き手に渡す。同じ理由で続けて失敗しても、知らせるのは1回だけ（2秒ごとに窓を出さない）。
 *   保存が済むか失敗の種類が変われば、次の失敗でまた知らせる。窓の文は `failureMessage`
 *
 * 状態を返し、変わったら知らせるだけ。画面には載せない（作品の画面がまだ無い）。
 */

export type AutoSaveStatus = "保存済み" | "保存待ち" | "外で変わりました";

export const AUTO_SAVE_DELAY_MS = 2000;

/** 時計（テストで偽の時計に差し替える） */
export interface AutoSaveTimer {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

/** `document` のうち、裏に回ったことを知るのに使う所だけ */
export interface VisibilitySource {
  readonly visibilityState: string;
  addEventListener(type: "visibilitychange", listener: () => void): void;
  removeEventListener(type: "visibilitychange", listener: () => void): void;
}

export interface AutoSaveFailure {
  reason: WriteTextFailureReason;
  detail?: string;
}

export interface AutoSaveOptions {
  store: FileStore;
  /** 話のパス（置き場の根から。例 `作品/原稿/第1話.txt`） */
  path: string;
  /** 話を開いたときに読んだもの（`readTextFile` の戻り値） */
  opened: Pick<TextFileContent, "text" | "hash" | "encoding" | "eol" | "hasTrailingNewline">;
  /** 打つのを止めてから保存するまで（既定 2000ms） */
  delayMs?: number;
  /** 既定は `globalThis` の `setTimeout`・`clearTimeout`（呼んだときに引く） */
  timer?: AutoSaveTimer;
}

export interface AutoSave {
  readonly path: string;
  status(): AutoSaveStatus;
  /** いまの書きかけ（外で変わって止まったあとも残る） */
  draft(): string;
  /** 最後の保存が失敗した理由（済めば消える） */
  lastFailure(): AutoSaveFailure | undefined;
  /** 書きかけを渡す。打つのを止めて2秒で保存する */
  edit(text: string): void;
  /** いま保存する（話を移るとき・裏に回るとき）。保存が済んでから、そのときの状態を返す */
  flush(): Promise<AutoSaveStatus>;
  /** 裏に回ったら保存する。外す関数を返す。既定は `document` */
  watchVisibility(source?: VisibilitySource): () => void;
  /** 外で変わった以外の失敗を知らせる（呼ぶ側が真ん中の窓で出す）。同じ理由が続くあいだは1回だけ。外す関数を返す */
  onFailure(listener: (failure: AutoSaveFailure) => void): () => void;
  /** 状態が変わったら知らせる。外す関数を返す */
  onStatusChange(listener: (status: AutoSaveStatus) => void): () => void;
  /** 時計と聞き手を外す（保存はしない。要るなら先に `flush()`） */
  dispose(): void;
}

const defaultTimer: AutoSaveTimer = {
  setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>),
};

export function createAutoSave(options: AutoSaveOptions): AutoSave {
  const { store, path, opened } = options;
  const delayMs = options.delayMs ?? AUTO_SAVE_DELAY_MS;
  const timer = options.timer ?? defaultTimer;
  const format = { encoding: opened.encoding, eol: opened.eol, hasTrailingNewline: opened.hasTrailingNewline };

  let draft = opened.text;
  let savedText = opened.text;
  let hash = opened.hash;
  let recovered = false;
  let stopped = false;
  let disposed = false;
  let failure: AutoSaveFailure | undefined;
  let handle: unknown;
  let queue: Promise<void> = Promise.resolve();
  const listeners = new Set<(status: AutoSaveStatus) => void>();
  const failureListeners = new Set<(failure: AutoSaveFailure) => void>();
  /** 最後に知らせた失敗の種類（同じ種類なら、保存が済むまで2度は知らせない。detail は書き足した字の所で変わるので見ない） */
  let toldFailure: string | undefined;
  const detachers = new Set<() => void>();

  const status = (): AutoSaveStatus =>
    stopped ? "外で変わりました" : draft === savedText ? "保存済み" : "保存待ち";
  let lastStatus = status();

  function emit(): void {
    const now = status();
    if (now === lastStatus) return;
    lastStatus = now;
    for (const listener of [...listeners]) {
      try {
        listener(now);
      } catch {
        // 聞き手が投げても保存の列を止めない
      }
    }
  }

  function schedule(): void {
    clearTimer();
    if (stopped || disposed || draft === savedText) return;
    handle = timer.setTimeout(() => {
      handle = undefined;
      void flush();
    }, delayMs);
  }

  function clearTimer(): void {
    if (handle === undefined) return;
    timer.clearTimeout(handle);
    handle = undefined;
  }

  async function saveIfNeeded(): Promise<void> {
    if (stopped) return;
    if (draft === savedText) {
      // 保存した字へ戻した：書くものが無いので、前の失敗はもう当たらない
      failure = undefined;
      toldFailure = undefined;
      return;
    }
    const text = draft;
    try {
      const result = await writeTextFilePreservingFormat(store, path, text, format, hash, {
        skipRecovery: recovered,
      });
      if (result.ok) {
        savedText = text;
        hash = result.hash;
        recovered = true;
        failure = undefined;
        toldFailure = undefined;
        // 保存のあいだに打った字（前に保存した字へ戻したときも）が残っていて、時計が回っていなければ回す
        if (handle === undefined) schedule();
      } else {
        failure = { reason: result.reason, ...(result.detail !== undefined ? { detail: result.detail } : {}) };
        if (result.reason === "modified_externally") {
          stopped = true;
          clearTimer();
        }
      }
    } catch (error) {
      failure = { reason: "path_conflict", detail: error instanceof Error ? error.message : String(error) };
    }
    emit();
    tellFailure();
  }

  function tellFailure(): void {
    if (!failure || stopped) return;
    const key = failure.reason;
    if (key === toldFailure) return;
    toldFailure = key;
    for (const listener of [...failureListeners]) {
      try {
        listener(failure);
      } catch {
        // 聞き手が投げても保存の列を止めない
      }
    }
  }

  function flush(): Promise<AutoSaveStatus> {
    clearTimer();
    queue = queue.then(saveIfNeeded, saveIfNeeded);
    return queue.then(status);
  }

  return {
    path,
    status,
    draft: () => draft,
    lastFailure: () => failure,
    edit(text: string): void {
      draft = text;
      schedule();
      emit();
    },
    flush,
    watchVisibility(source?: VisibilitySource): () => void {
      const target = source ?? (globalThis.document as VisibilitySource | undefined);
      if (!target) return () => undefined;
      const onChange = (): void => {
        if (target.visibilityState === "hidden") void flush();
      };
      target.addEventListener("visibilitychange", onChange);
      const detach = (): void => {
        target.removeEventListener("visibilitychange", onChange);
        detachers.delete(detach);
      };
      detachers.add(detach);
      return detach;
    },
    onFailure(listener) {
      failureListeners.add(listener);
      return () => failureListeners.delete(listener);
    },
    onStatusChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose(): void {
      disposed = true;
      clearTimer();
      for (const detach of [...detachers]) detach();
      listeners.clear();
      failureListeners.clear();
    },
  };
}

/**
 * 外で変わった以外の失敗の、真ん中の窓の文（2026-11-15 作者の答え「その場で真ん中の窓」）。
 * 書きかけは残っていることも添える（原稿を失わないかが作者の気がかり）
 */
export function failureMessage(failure: AutoSaveFailure): string {
  const head =
    failure.reason === "encoding_error"
      ? "Shift_JIS の原稿に書けない字があるので、保存していません"
      : failure.reason === "conflict_markers"
        ? "競合の印（<<<<<<< など）があるので、保存していません"
        : "保存できませんでした";
  return [head, failure.detail, "書きかけは残っています"].filter((line): line is string => !!line).join("\n");
}
