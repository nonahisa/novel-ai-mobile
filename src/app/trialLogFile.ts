/**
 * **試しの画面の記録を、ファイルにも書き出す**（2026-11-08 母艦の頼み：iPad の記録を読むのに、Mac の Safari の
 * Web インスペクタを作者が操作していた。作者の手を減らすため、アプリの書類の置き場へ書き、Mac のセッションが
 * devicectl で取り出す）。
 *
 * - 置き場：`trial-log/ime-log-<開いた日時>.txt`（iOS は Documents、それ以外はアプリ専用の領域）。
 *   作者の原稿（`works/`）とは別の場所で、原稿には書かない
 * - 試しの画面を開くたびに新しいファイル（名前に日時を入れて、作者が試した回と取り違えないように）
 * - 古い順に1行ずつ。画面の記録（12000 字で切る）と違い、`maxLines` 行まで残す
 * - 書くのは、記録が増えてから `delayMs` 落ち着いたときに1回（打つたびに書かない）
 */
export interface TrialLogDeps {
  write(path: string, data: string): Promise<void>;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
}

export interface TrialLog {
  readonly path: string;
  add(line: string): void;
  /** すぐ書く（画面を閉じるときなど） */
  flush(): Promise<void>;
}

/** 開いた日時から、ファイルの名前を作る（例：trial-log/ime-log-20261108-163005.txt） */
export function trialLogPath(at: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  const stamp = `${at.getFullYear()}${p(at.getMonth() + 1)}${p(at.getDate())}-${p(at.getHours())}${p(at.getMinutes())}${p(at.getSeconds())}`;
  return `trial-log/ime-log-${stamp}.txt`;
}

export function createTrialLog(at: Date, deps: TrialLogDeps, delayMs = 500, maxLines = 5000): TrialLog {
  const path = trialLogPath(at);
  const lines: string[] = [];
  let timer: unknown;
  let writing: Promise<void> = Promise.resolve();
  const flush = (): Promise<void> => {
    if (timer !== undefined) deps.clearTimer(timer);
    timer = undefined;
    const data = lines.join("\n") + "\n";
    // 前の書き込みが済んでから書く（順が入れ替わって古い中身で上書きしないように）
    writing = writing.then(() => deps.write(path, data)).catch(() => undefined);
    return writing;
  };
  return {
    path,
    add(line) {
      lines.push(line);
      if (lines.length > maxLines) lines.splice(0, lines.length - maxLines);
      if (timer !== undefined) deps.clearTimer(timer);
      timer = deps.setTimer(() => {
        timer = undefined;
        void flush();
      }, delayMs);
    },
    flush,
  };
}
