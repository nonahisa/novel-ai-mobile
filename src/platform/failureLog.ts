/**
 * **失敗の記録**（障害報告用の記録の材料。2026-11-28 作者の答え「残してよい」：アプリの領域だけ・7日か1MB・原稿なし）。
 *
 * モバイル版は、それまで失敗を知らせ（トースト・窓）に出すだけで、ファイルには残していなかった。
 * 障害報告用の記録（本体 `core/issueReport.ts`）が読めるように、**本体の動作の記録（actions.log）と同じ形**で書く：
 *
 * ```
 * [2026-11-28 09:05:07] --- 誤字脱字の確認 ---
 *   種別: timeout
 *   詳細: 60秒で返事がありませんでした
 * ```
 *
 * - **原稿の文は書かない。** 書くのは「何をしていて」（決まった言葉）と、種別・使っていた AI・知らせの文だけ。
 *   知らせの文に原稿やAIの応答が混ざっても、書き出すときに本体の伏せ方（長い日本語の続きを伏せる網など）を通る
 * - 値は1行に収める（改行を空白に）。続きの行が別の鍵に読まれないように
 * - 書き足すたびに、7日より古い記録と、1MB を超えた古い分を落とす（記録の途中では切らない）
 * - **投げない。** 書けない・読めない端末でも、失敗の記録のせいで画面を止めない
 *
 * 置き場はアプリの領域（`app/failureLogFile.ts`）。作品のフォルダーには書かないので、同期にも乗らない。
 */

export const FAILURE_LOG_MAX_AGE_DAYS = 7;
export const FAILURE_LOG_MAX_BYTES = 1_000_000;

export interface FailureLogIo {
  /** 無ければ undefined */
  read(): Promise<string | undefined>;
  write(text: string): Promise<void>;
}

export interface FailureLog {
  /** 失敗を1件書き足す。error は Error か知らせの文。fields は種別・使用中のAI など */
  note(context: string, error: unknown, fields?: Readonly<Record<string, string | undefined>>): Promise<void>;
  /** いまの記録（古い分を落としたもの）。読めなければ空 */
  read(): Promise<string>;
}

const pad2 = (n: number) => String(n).padStart(2, "0");

function stamp(at: Date): string {
  return (
    `[${at.getFullYear()}-${pad2(at.getMonth() + 1)}-${pad2(at.getDate())} ` +
    `${pad2(at.getHours())}:${pad2(at.getMinutes())}:${pad2(at.getSeconds())}]`
  );
}

const oneLine = (value: string) => value.replace(/\r?\n|\r/g, " ").replace(/\s{2,}/g, " ").trim();

/** 1件ぶんの行（末尾に改行）。鍵の並びは渡した順 */
export function formatFailureRecord(at: Date, context: string, fields: ReadonlyArray<readonly [string, string]>): string {
  // 見出しの「---」で記録の区切りを偽らないように、中の続く「-」を1つにする
  const head = oneLine(context).replace(/-{2,}/g, "-");
  const lines = [`${stamp(at)} --- ${head} ---`];
  for (const [key, value] of fields) {
    lines.push(`  ${oneLine(key).replace(/:/g, "：")}: ${oneLine(value)}`);
  }
  return `${lines.join("\n")}\n`;
}

const RECORD_HEAD = /^\[(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})\]/;

/** 記録ごとに分ける（時刻の行で始まり、時刻の無い行はその記録に付く）。最初の時刻より前の行は捨てる */
function splitRecords(text: string): Array<{ time: Date; text: string }> {
  const records: Array<{ time: Date; lines: string[] }> = [];
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\r$/, "");
    const head = RECORD_HEAD.exec(line);
    if (head) {
      const [y, mo, d, h, mi, s] = head.slice(1, 7).map(Number);
      records.push({ time: new Date(y, mo - 1, d, h, mi, s), lines: [line] });
      continue;
    }
    if (line !== "" && records.length > 0) records[records.length - 1].lines.push(line);
  }
  return records.map((r) => ({ time: r.time, text: `${r.lines.join("\n")}\n` }));
}

/** 7日より古い記録と、上限を超えた古い分を落とす */
export function pruneFailureLog(text: string, now: Date, maxBytes = FAILURE_LOG_MAX_BYTES): string {
  const oldest = now.getTime() - FAILURE_LOG_MAX_AGE_DAYS * 24 * 3_600_000;
  const kept = splitRecords(text).filter((r) => r.time.getTime() >= oldest);
  const encoder = new TextEncoder();
  let used = 0;
  let start = kept.length;
  while (start > 0) {
    const size = encoder.encode(kept[start - 1].text).byteLength;
    if (used + size > maxBytes) break;
    used += size;
    start--;
  }
  return kept.slice(start).map((r) => r.text).join("");
}

function describe(error: unknown): { kind: string; detail: string } {
  if (error instanceof Error) {
    // AI の失敗（本体の AIError）は、種類（timeout・authentication_failed など）を種別にする
    const kind = (error as { kind?: unknown }).kind;
    return { kind: typeof kind === "string" && kind !== "" ? kind : error.name || "Error", detail: error.message };
  }
  return { kind: "", detail: String(error) };
}

export function createFailureLog(io: FailureLogIo, clock: () => Date = () => new Date()): FailureLog {
  // 書き足しは1本の列に並べる（続けて呼ばれても、読んで足して書くが重ならない）
  let queue: Promise<void> = Promise.resolve();
  const readSafe = async (): Promise<string> => {
    try {
      return (await io.read()) ?? "";
    } catch {
      return "";
    }
  };
  return {
    note(context, error, fields = {}) {
      const now = clock();
      const { kind, detail } = describe(error);
      const entries: Array<[string, string]> = [];
      const givenKind = fields["種別"];
      if (givenKind || kind) entries.push(["種別", givenKind || kind]);
      for (const [key, value] of Object.entries(fields)) {
        if (key === "種別" || value === undefined || value === "") continue;
        entries.push([key, value]);
      }
      if (detail) entries.push(["詳細", detail]);
      const record = formatFailureRecord(now, context, entries);
      queue = queue.then(async () => {
        try {
          const before = await readSafe();
          await io.write(pruneFailureLog(before + record, now));
        } catch {
          // 書けなくても画面は止めない
        }
      });
      return queue;
    },
    async read() {
      await queue;
      return pruneFailureLog(await readSafe(), clock());
    },
  };
}

/*
  画面のどこからでも呼べる口。起動のときに `setFailureLog` で本物を渡す（試しや確認のページでは渡さないので、何もしない）。
*/
let current: FailureLog | undefined;

export function setFailureLog(log: FailureLog | undefined): void {
  current = log;
}

export function currentFailureLog(): FailureLog | undefined {
  return current;
}

/** 失敗を残す。待たなくてよい（投げない） */
export function noteFailure(
  context: string,
  error: unknown,
  fields?: Readonly<Record<string, string | undefined>>,
): void {
  void current?.note(context, error, fields);
}
