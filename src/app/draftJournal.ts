import { sha256Text } from "novel-ai-assistant/src/core/hash";
import { FileNotFoundError, joinStorePath, normalizeStorePath, type FileStore } from "../platform/fileStore";

/**
 * **書きかけの控え**（設計書 5.3 の4「書きかけは打鍵ごとに端末に控える」）。
 *
 * Android は裏に回したアプリを予告なく止める。自動保存（5.4）は打つのを止めて2秒で書くが、その2秒の間や、
 * 保存できなかった書きかけ（外で変わった・書けない字）は、止められると失う。そこで、打つたびに書きかけを
 * 端末の控えに書いておき、次に開いたときに戻す。
 *
 * - 控えの置き場は {@link JOURNAL_DIRECTORY}（作品の外・`.aiwriter` の外。同期しない）。話ごとに1つ
 *   （名前は話のパスのハッシュ。原稿の名前を置き場に出さない）
 * - 打つたびに書くと書き込みが多いので、{@link JOURNAL_DELAY_MS} だけ待ってまとめる。裏に回るときは
 *   `flush()` ですぐ書く
 * - 書き込みは1つずつ。最後に渡した書きかけが必ず最後に書かれる
 * - **控えは保存が済んだら消す**（`clear()`）。作者が書きかけを捨てたときも消す
 * - 控えは UTF-8 で書く（原稿の文字コードとは関係ない。戻すのは本文の字だけ）
 * - `base` を渡すと、控えを書くたびに「その書きかけのもとになった本文」のハッシュを頭の1行に添える
 *   （{@link JOURNAL_BASE_LINE}）。開き直したとき、本文が外で変わっていたかを見分けるため
 *   （2026-11-16 作者の答え「本文が変わったときだけ訊く」）。添えていない控えは `base` が無い
 */

export const JOURNAL_DIRECTORY = ".novelai-drafts";
export const JOURNAL_DELAY_MS = 300;

export interface JournalTimer {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface DraftJournal {
  /** 書きかけを渡す（少し待ってまとめて控えに書く） */
  note(text: string): void;
  /** 待っている書きかけをすぐ控えに書く（裏に回るとき） */
  flush(): Promise<void>;
  /** 控えを読む（書きかけの字だけ）。無ければ undefined */
  read(): Promise<string | undefined>;
  /** 控えを、もとになった本文のハッシュといっしょに読む。無ければ undefined */
  readEntry(): Promise<JournalEntry | undefined>;
  /** 控えを消す（保存が済んだ・書きかけを捨てた） */
  clear(): Promise<void>;
}

export interface JournalEntry {
  text: string;
  /** 書きかけのもとになった本文の SHA-256（添えていない控えは undefined） */
  base?: string;
}

/** 控えの頭に添える行。`<ハッシュ>` は本文の SHA-256（16進 64字） */
export const JOURNAL_BASE_LINE = /^#novelai-draft base=([0-9a-f]{64})\n/;

export function encodeJournal(text: string, baseText: string | undefined): string {
  return baseText === undefined ? text : `#novelai-draft base=${sha256Text(baseText)}\n${text}`;
}

export function decodeJournal(raw: string): JournalEntry {
  const head = JOURNAL_BASE_LINE.exec(raw);
  return head ? { text: raw.slice(head[0].length), base: head[1]! } : { text: raw };
}

/**
 * 開いたときの控えの扱い（2026-11-16 作者の答え「本文が変わったときだけ訊く」）
 *
 * - `none`：控えが無い
 * - `stale`：控えがいまの本文と同じ（消し忘れ）。黙って消す
 * - `restore`：控えのもとの本文がいまの本文と同じ。黙って戻す
 * - `ask`：控えを書いたあとで本文が変わった（同期で入れ替わった・外で変わった）、
 *   またはもとの本文が分からない。［書きかけを戻す］［戻さない］を訊く
 */
export type RestoreDecision = "none" | "stale" | "restore" | "ask";

export function restoreDecision(entry: JournalEntry | undefined, saved: string): RestoreDecision {
  if (entry === undefined) return "none";
  if (entry.text === saved) return "stale";
  return entry.base !== undefined && entry.base === sha256Text(saved) ? "restore" : "ask";
}

/** 話のパスに対する控えのパス */
export function journalPathFor(path: string): string {
  return joinStorePath(JOURNAL_DIRECTORY, `${sha256Text(normalizeStorePath(path))}.txt`);
}

/**
 * 開いたときに控えを戻すか。控えが在り、保存してある本文と違うときだけ戻す
 * （同じなら、控えを消し忘れただけ）
 */
export function shouldRestore(journal: string | undefined, saved: string): journal is string {
  return journal !== undefined && journal !== saved;
}

const defaultTimer: JournalTimer = {
  setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>),
};

export function createDraftJournal(
  store: FileStore,
  path: string,
  options: {
    delayMs?: number;
    timer?: JournalTimer;
    onError?: (error: unknown) => void;
    /** 書きかけのもとになっている本文（書くたびに聞く。保存が済むと変わる） */
    base?: () => string;
  } = {}
): DraftJournal {
  const file = journalPathFor(path);
  const delayMs = options.delayMs ?? JOURNAL_DELAY_MS;
  const timer = options.timer ?? defaultTimer;
  let pending: string | undefined;
  let handle: unknown;
  let queue: Promise<void> = Promise.resolve();

  const enqueue = (job: () => Promise<void>): Promise<void> => {
    queue = queue.then(job).catch((error) => options.onError?.(error));
    return queue;
  };

  const write = async (text: string, baseText: string | undefined): Promise<void> => {
    const bytes = new TextEncoder().encode(encodeJournal(text, baseText));
    try {
      await store.writeFile(file, bytes, { mode: "overwrite" });
    } catch (error) {
      if (!(error instanceof FileNotFoundError)) throw error;
      await store.createDirectory(JOURNAL_DIRECTORY);
      await store.writeFile(file, bytes, { mode: "create" });
    }
  };

  const cancelTimer = () => {
    if (handle === undefined) return;
    timer.clearTimeout(handle);
    handle = undefined;
  };

  const flush = (): Promise<void> => {
    cancelTimer();
    if (pending === undefined) return queue;
    const text = pending;
    pending = undefined;
    // もとの本文は、書きかけを受け取った時点のもの（並んで待つあいだに保存が済んでも変えない）
    const baseText = options.base?.();
    return enqueue(() => write(text, baseText));
  };

  const readEntry = async (): Promise<JournalEntry | undefined> => {
    await queue;
    try {
      const raw = new TextDecoder().decode(await store.readFile(file));
      // 添えていない係（縦書きの試し）の控えは、字のまま
      return options.base ? decodeJournal(raw) : { text: raw };
    } catch (error) {
      if (error instanceof FileNotFoundError) return undefined;
      throw error;
    }
  };

  return {
    note(text) {
      pending = text;
      cancelTimer();
      handle = timer.setTimeout(() => {
        handle = undefined;
        void flush();
      }, delayMs);
    },
    flush,
    async read() {
      return (await readEntry())?.text;
    },
    readEntry,
    clear() {
      cancelTimer();
      pending = undefined;
      return enqueue(async () => {
        try {
          await store.deleteFile(file);
        } catch (error) {
          if (!(error instanceof FileNotFoundError)) throw error;
        }
      });
    },
  };
}
