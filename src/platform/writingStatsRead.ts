import type { FileStore } from "./fileStore";
import { FileNotFoundError, normalizeStorePath } from "./fileStore";

/**
 * **執筆統計（I）を読む**（設計書 2章の I「今日・今週の字数。端末ごとに記録して、表示のときに足す（共通設計書 3.4）」）。
 *
 * - 記録は本体と同じ `.aiwriter/stats/<端末>.json`（端末ごとに1つ。同期で届く）
 * - 読み方は本体の `core/writingStatsFiles.ts`・`core/writingStats.ts`（`parseDeviceWritingStats`・`mergeDailyStats`・
 *   `statsDayKey`・`weekStartKey`・`sumRange`）と同じ決まりを、読むのに要る所だけ写した。本体のその部品は型を
 *   `import type` で読んでおらず、このアプリの型検査（`verbatimModuleSyntax`）を通らないため。決まり：
 *   壊れた記録（競合の印が混ざった・形の違う）は黙って飛ばす／壊れた日だけ飛ばし残りの日は使う／端末の名前は
 *   英小文字・数字・`_`・`-` の64字まで／日の境目は朝4時・週の始めは月曜（本体の既定。本体の設定で変えていても、いまは既定）
 * - この端末で書いた分の記録は `writingStatsRecord.ts`（2026-11-20 夜から。同じファイルの形で書く）。ここは全端末の分を読んで足す
 */
export const WRITING_STATS_FOLDER = ".aiwriter/stats";
const SCHEMA_VERSION = "1";
const DAY_BOUNDARY_HOUR = 4;
const WEEK_START = 1;

/** 1日分（本体の `DailyStat` のうち、ここで使う所） */
export interface WritingDay {
  /** 日の境目を当てた YYYY-MM-DD */
  date: string;
  /** 純字数の増減（削った日は負） */
  net: number;
}

const isDayKey = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
const isDeviceId = (value: unknown): value is string => typeof value === "string" && /^[a-z0-9][a-z0-9_-]{0,63}$/.test(value);
const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

/** 記録のファイル1つ。壊れていれば undefined（投げない） */
export function parseWritingStatsFile(text: string): WritingDay[] | undefined {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return undefined;
  const record = raw as Record<string, unknown>;
  if (record.schemaVersion !== SCHEMA_VERSION || !isDeviceId(record.deviceId) || !Array.isArray(record.days)) return undefined;
  const days: WritingDay[] = [];
  for (const entry of record.days) {
    if (typeof entry !== "object" || entry === null) continue;
    const day = entry as Record<string, unknown>;
    // 本体と同じく、総字数（gross）の無い日は壊れた日として飛ばす
    if (isDayKey(day.date) && isNumber(day.net) && isNumber(day.gross)) days.push({ date: day.date, net: day.net });
  }
  return days;
}

/** 作品の、全端末を足した日ごとの記録（日付の順）。記録が無ければ空 */
export async function readWorkWritingDays(store: FileStore, workRoot: string): Promise<WritingDay[]> {
  const dir = normalizeStorePath(`${workRoot}/${WRITING_STATS_FOLDER}`);
  let names: string[];
  try {
    names = await store.listFiles(dir);
  } catch (error) {
    if (error instanceof FileNotFoundError) return [];
    throw error;
  }
  const merged = new Map<string, number>();
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    let days: WritingDay[] | undefined;
    try {
      days = parseWritingStatsFile(new TextDecoder().decode(await store.readFile(`${dir}/${name}`)));
    } catch {
      days = undefined; // 読めない記録は、壊れた記録と同じく飛ばす
    }
    for (const day of days ?? []) merged.set(day.date, (merged.get(day.date) ?? 0) + day.net);
  }
  return [...merged].map(([date, net]) => ({ date, net })).sort((a, b) => a.date.localeCompare(b.date));
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/** その時刻が何日の執筆か（作者の時計で。朝4時より前は前の日） */
export function statsDayKey(at: Date): string {
  const shifted = new Date(at.getTime() - DAY_BOUNDARY_HOUR * 3_600_000);
  return `${shifted.getFullYear()}-${pad2(shifted.getMonth() + 1)}-${pad2(shifted.getDate())}`;
}

/** その日の週の始め（月曜）。日付の計算は UTC の上で（夏時間でずれないように。本体と同じ） */
export function weekStartKey(key: string): string {
  const [year, month, day] = key.split("-").map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day!));
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() - WEEK_START + 7) % 7));
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

export interface WritingSummary {
  /** 今日の純字数（削った日は負） */
  today: number;
  /** 今週（月曜から今日まで）の純字数 */
  week: number;
}

/** 今日と今週の字数 */
export function writingSummary(days: readonly WritingDay[], now: Date): WritingSummary {
  const today = statsDayKey(now);
  const from = weekStartKey(today);
  const sum = (start: string) => days.filter((d) => d.date >= start && d.date <= today).reduce((n, d) => n + d.net, 0);
  return { today: sum(today), week: sum(from) };
}
