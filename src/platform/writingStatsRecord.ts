import {
  emptyDeviceStats,
  fileCountKey,
  parseDeviceWritingStats,
  placeOpenBaseline,
  rebaseline,
  recordMeasurement,
  sameBaseline,
  shouldPersist,
} from "novel-ai-assistant/src/core/writingStats";
import type { DeviceWritingStats, FileCountMap, WritingMeasurement } from "novel-ai-assistant/src/models/writingStats";
import { FileNotFoundError, joinStorePath, type FileStore } from "./fileStore";
import { toStorePath } from "./paths";
import { scanWorkFolder, type ScannedWork } from "./workScan";
import { WRITING_STATS_FOLDER } from "./writingStatsRead";

/**
 * **この端末で書いた字数を記録する**（設計書 2章の I「端末ごとに記録して、表示のときに足す」。2026-11-20 夜 作者の答え
 * 「パソコンと同じく基準も記録のファイルに」）。
 *
 * 記録は本体と同じ `.aiwriter/stats/<この端末>.json`（日ごとの字数と、差を取るための基準）。決まりは本体の
 * `core/writingStats.ts` をそのまま使う（写さない）。読み書きの流れは本体の `core/writingStatsStore.ts`・
 * `features/writingProgress.ts` と同じ：
 *
 * - **保存したとき**（`record`）：作品を測り、基準との差をその日の字数に積む。初回・話の数や競合の数が変わった回は数えず基準だけ
 *   置き直す。増減が無ければ書かない（`shouldPersist`）
 * - **話を開いたとき**（`noteOpened`）：その日にその話の起点が無ければ、開いた話の分だけ基準を置き直す（1日1回。本体の
 *   2026-11-12 の答え）。数えない
 * - **パソコンの変更を取り込んだとき・競合を選んだとき**（`rebaseline`）：数えずに基準だけ置き直す（取り込んだ字を、この端末で
 *   書いたことにしない）
 * - 基準が字数として同じなら書かない（`sameBaseline`。測った時刻だけ変わったファイルを作らない。本体の 2026-09-15 の直し）
 *
 * 基準だけを置き直した記録は、送っていない変更に数えず、自動の取得も止めない（`workSync.ts` の `isBaselineOnlyStatsChange`）。
 * 記録に失敗しても書くことは止めない（黙って次の回に任せる）。同じ作品の読み書きは1つずつ（開いた直後の保存と重ならない）
 */
export function statsFilePath(root: string, deviceId: string): string {
  return joinStorePath(root, WRITING_STATS_FOLDER, `${deviceId}.json`);
}

/** 作品の中の話の鍵（作品フォルダーからの道。区切りは `/`。本体の `fileCountKeyFor` と同じ） */
export function episodeKey(root: string, storePath: string): string {
  const prefix = `${root}/`;
  return fileCountKey(storePath.startsWith(prefix) ? storePath.slice(prefix.length) : storePath);
}

/** 読んだ作品を、記録の入力へ（本体の `toMeasurement`。競合の印のある話は内訳に載せない） */
export function measurementOf(work: ScannedWork): WritingMeasurement {
  const files: FileCountMap = {};
  for (const episode of work.episodes) {
    if (episode.hasConflictMarkers) continue;
    const storePath = toStorePath(episode.filePath);
    if (storePath === undefined) continue;
    files[episodeKey(work.root, storePath)] = { net: episode.counts.net, gross: episode.counts.gross };
  }
  return { net: work.stats.totals.net, gross: work.stats.totals.gross, fileCount: work.episodes.length, conflictedCount: work.stats.conflictedCount, files };
}

async function loadOwn(store: FileStore, root: string, deviceId: string): Promise<DeviceWritingStats> {
  try {
    const bytes = await store.readFile(statsFilePath(root, deviceId));
    return parseDeviceWritingStats(JSON.parse(new TextDecoder().decode(bytes))) ?? emptyDeviceStats(deviceId);
  } catch (error) {
    // 無い：新しく始める。壊れている（競合の印が混ざったなど）：本体と同じく新しく始める（原稿は無事）
    if (error instanceof FileNotFoundError) return emptyDeviceStats(deviceId);
    return emptyDeviceStats(deviceId);
  }
}

async function save(store: FileStore, root: string, deviceId: string, stats: DeviceWritingStats): Promise<void> {
  await store.createDirectory(joinStorePath(root, WRITING_STATS_FOLDER)).catch(() => undefined);
  const bytes = new TextEncoder().encode(`${JSON.stringify(stats, null, 2)}\n`);
  try {
    await store.writeFile(statsFilePath(root, deviceId), bytes, { mode: "overwrite" });
  } catch (error) {
    // 初めての記録（置き場の決まりで、無いファイルは overwrite では書けない）
    if (!(error instanceof FileNotFoundError)) throw error;
    await store.writeFile(statsFilePath(root, deviceId), bytes, { mode: "create" });
  }
}

export interface WritingRecorder {
  /** 保存したとき。数えたら増えた字数（数えなければ 0） */
  record(root: string): Promise<number>;
  /** 話を開いたとき（その日に1回だけ） */
  noteOpened(root: string, storePath: string): Promise<void>;
  /** パソコンの変更を取り込んだとき・競合を選んだとき */
  rebaseline(root: string): Promise<void>;
}

export interface WritingRecorderDeps {
  store: FileStore;
  deviceId(): Promise<string>;
  /** 作品を測る（既定は `scanWorkFolder`） */
  scan?: (root: string) => Promise<ScannedWork>;
  now?: () => Date;
}

/** 日の境目（朝4時。本体の既定。作者の答え 2026-11-20 夜「既定のまま」） */
const BOUNDARY_HOUR = 4;

function dayKey(at: Date): string {
  const shifted = new Date(at.getTime() - BOUNDARY_HOUR * 60 * 60 * 1000);
  return `${shifted.getFullYear()}-${String(shifted.getMonth() + 1).padStart(2, "0")}-${String(shifted.getDate()).padStart(2, "0")}`;
}

export function createWritingRecorder(deps: WritingRecorderDeps): WritingRecorder {
  const scan = deps.scan ?? ((root: string) => scanWorkFolder(deps.store, root));
  const now = deps.now ?? (() => new Date());
  const tails = new Map<string, Promise<unknown>>();
  /** その日にもう起点を置いた話（開き直しで置き直さない。本体の `OpenDayGate`） */
  const opened = new Map<string, string>();
  const serial = <T>(root: string, task: () => Promise<T>): Promise<T> => {
    const run = (tails.get(root) ?? Promise.resolve()).then(task, task);
    tails.set(root, run.catch(() => undefined));
    return run;
  };
  return {
    record: (root) =>
      serial(root, async () => {
        try {
          const id = await deps.deviceId();
          const current = await loadOwn(deps.store, root, id);
          const result = recordMeasurement(current, measurementOf(await scan(root)), { at: now(), boundaryHour: BOUNDARY_HOUR });
          if (shouldPersist(result)) await save(deps.store, root, id, result.stats);
          return result.counted ? result.delta : 0;
        } catch {
          return 0;
        }
      }),
    noteOpened: async (root, storePath) => {
      const key = `${root}\u0000${storePath}`;
      const day = dayKey(now());
      if (opened.get(key) === day) return;
      opened.set(key, day);
      await serial(root, async () => {
        try {
          const id = await deps.deviceId();
          const current = await loadOwn(deps.store, root, id);
          const next = placeOpenBaseline(current, measurementOf(await scan(root)), episodeKey(root, storePath), now());
          if (!sameBaseline(current.baseline, next.baseline)) await save(deps.store, root, id, next);
        } catch {
          opened.delete(key);
        }
      });
    },
    rebaseline: (root) =>
      serial(root, async () => {
        try {
          const id = await deps.deviceId();
          const current = await loadOwn(deps.store, root, id);
          const next = rebaseline(current, measurementOf(await scan(root)), now());
          if (!sameBaseline(current.baseline, next.baseline)) await save(deps.store, root, id, next);
        } catch {
          // 置き直せなくても、次に保存したとき話の数が同じなら差が出る（本体と同じく止めない）
        }
      }),
  };
}

/**
 * 記録のファイルの変更が、**基準を置き直しただけ**か（日ごとの字数が変わっていない）。
 * 送っていない変更に数えるか・自動の取得を止めるかに使う（2026-11-20 夜 作者の答えの「取り込むたびに記録が変わり、
 * 自動の取り込みが止まる」を避ける）。
 *
 * - `before`：最後にそろえた版（HEAD）の中身。無ければ（初めての記録）日の記録が空なら基準だけ
 * - どちらかが読めない（壊れている）ときは「基準だけ」とは言わない（送っていない変更として見せる）
 */
export function isBaselineOnlyStatsChange(before: string | undefined, after: string | undefined): boolean {
  if (after === undefined) return false;
  const next = parseStats(after);
  if (!next) return false;
  if (before === undefined) return next.days.length === 0;
  const prev = parseStats(before);
  if (!prev) return false;
  return prev.deviceId === next.deviceId && JSON.stringify(prev.days) === JSON.stringify(next.days);
}

function parseStats(text: string): DeviceWritingStats | undefined {
  try {
    return parseDeviceWritingStats(JSON.parse(text));
  } catch {
    return undefined;
  }
}

/** 記録のファイルの道か（作品フォルダーの中の `.aiwriter/stats/*.json`） */
export function isStatsFilePath(path: string): boolean {
  return /(^|\/)\.aiwriter\/stats\/[^/]+\.json$/.test(path);
}
