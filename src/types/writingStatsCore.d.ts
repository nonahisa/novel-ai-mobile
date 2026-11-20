/**
 * 本体の `core/writingStats.ts` の、モバイル版が使う関数の形（型検査だけに使う。組み立てと試験は本体のファイルをそのまま使う）。
 *
 * 本体のそのファイルは型を `import type` で読んでいない所があり、このアプリの型検査（`verbatimModuleSyntax`）を
 * 通らない（引継ぎ書 143章）。そこで `tsconfig.json` の `paths` で型検査のときだけここを読ませる。**中身は写さない**
 * （決まりは本体のまま）。本体の版を上げて形が変わったら、`test/writingStatsRecord.test.ts` の本体との突き合わせが落ちる
 */
import type { DeviceWritingStats, WritingBaseline, WritingMeasurement } from "novel-ai-assistant/src/models/writingStats";

export interface RecordResult {
  stats: DeviceWritingStats;
  delta: number;
  counted: boolean;
  reason?: "baseline" | "structure_changed" | "no_change";
}
export function emptyDeviceStats(deviceId: string): DeviceWritingStats;
export function parseDeviceWritingStats(value: unknown): DeviceWritingStats | undefined;
export function fileCountKey(relativePath: string): string;
export function recordMeasurement(stats: DeviceWritingStats, measurement: WritingMeasurement, options?: { at?: Date; boundaryHour?: number }): RecordResult;
export function shouldPersist(result: RecordResult): boolean;
export function rebaseline(stats: DeviceWritingStats, measurement: WritingMeasurement, at?: Date): DeviceWritingStats;
export function placeOpenBaseline(stats: DeviceWritingStats, measurement: WritingMeasurement, fileKey: string, at?: Date): DeviceWritingStats;
export function sameBaseline(left: WritingBaseline | undefined, right: WritingBaseline | undefined): boolean;
export const DEFAULT_DAY_BOUNDARY_HOUR: number;
