import { describe, expect, test } from "vitest";
import { MemoryFileStore } from "../src/platform/memoryFileStore";
import { readWorkWritingDays, writingSummary } from "../src/platform/writingStatsRead";

/**
 * 執筆統計（I）を読む（設計書 2章の I「今日・今週の字数。端末ごとに記録して、表示のときに足す」）。
 * 記録は本体と同じ `.aiwriter/stats/<端末>.json`。作品は作り物（`_確認用`）だけで試す
 */
const WORK = "作品_確認用";
const enc = (text: string) => new TextEncoder().encode(text);
const record = (deviceId: string, days: Array<{ date: string; net: number }>) =>
  JSON.stringify({ schemaVersion: "1", deviceId, days: days.map((d) => ({ ...d, gross: d.net, saves: 1 })) });

describe("作品の執筆の記録を読む", () => {
  test("記録が無ければ空（作品が無くても投げない）", async () => {
    expect(await readWorkWritingDays(new MemoryFileStore(), WORK)).toEqual([]);
  });

  test("端末ごとの記録を日ごとに足す。壊れた記録と .json でないものは飛ばす", async () => {
    const store = new MemoryFileStore();
    store.putExternally(`${WORK}/.aiwriter/stats/pc-aaaa.json`, enc(record("pc-aaaa", [{ date: "2026-11-19", net: 300 }])));
    store.putExternally(`${WORK}/.aiwriter/stats/pc-bbbb.json`, enc(record("pc-bbbb", [{ date: "2026-11-19", net: 200 }, { date: "2026-11-17", net: 50 }])));
    store.putExternally(`${WORK}/.aiwriter/stats/broken.json`, enc("<<<<<<< HEAD\n{"));
    store.putExternally(`${WORK}/.aiwriter/stats/memo.txt`, enc("x"));
    const days = await readWorkWritingDays(store, WORK);
    expect(days.map((d) => [d.date, d.net])).toEqual([
      ["2026-11-17", 50],
      ["2026-11-19", 500],
    ]);
  });
});

describe("今日・今週の字数", () => {
  // 2026-11-19 は木曜。週の始めは月曜（本体の既定）で 11-16。日の境目は朝4時（本体の既定）
  const days = [
    { date: "2026-11-15", net: 900, gross: 900, saves: 1 },
    { date: "2026-11-16", net: 100, gross: 100, saves: 1 },
    { date: "2026-11-18", net: -40, gross: 10, saves: 1 },
    { date: "2026-11-19", net: 560, gross: 560, saves: 1 },
  ];

  test("今日と、月曜からの今週を足す（先週の日は入れない）", () => {
    expect(writingSummary(days, new Date(2026, 10, 19, 12, 0))).toEqual({ today: 560, week: 620 });
  });

  test("朝4時より前は前の日として数える（本体と同じ）", () => {
    expect(writingSummary(days, new Date(2026, 10, 20, 3, 30))).toEqual({ today: 560, week: 620 });
  });

  test("記録が無ければ 0", () => {
    expect(writingSummary([], new Date(2026, 10, 19, 12, 0))).toEqual({ today: 0, week: 0 });
  });
});

describe("本体と同じ読み方か（写した決まりが離れていないか）", async () => {
  // 型検査に本体のその部品を通さない（`import type` で読んでいない所があり、このアプリの型検査を通らない）ので、
  // 名前を変数にして読み、使う形だけを書いておく
  const spec = "novel-ai-assistant/src/core/writingStats";
  const main = (await import(/* @vite-ignore */ spec)) as {
    statsDayKey(at: Date): string;
    weekStartKey(key: string): string;
    parseDeviceWritingStats(value: unknown): { days: Array<{ date: string; net: number }> } | undefined;
  };
  const { statsDayKey, weekStartKey, parseWritingStatsFile } = await import("../src/platform/writingStatsRead");

  test("日の境目と週の始め", () => {
    for (let h = 0; h < 24 * 16; h += 5) {
      const at = new Date(2026, 10, 10, h, 17);
      expect(statsDayKey(at)).toBe(main.statsDayKey(at));
      expect(weekStartKey(statsDayKey(at))).toBe(main.weekStartKey(statsDayKey(at)));
    }
  });

  test("壊れた記録・壊れた日の扱い", () => {
    const cases = [
      record("pc-aaaa", [{ date: "2026-11-19", net: 3 }]),
      JSON.stringify({ schemaVersion: "1", deviceId: "PC 大文字", days: [] }),
      JSON.stringify({ schemaVersion: "2", deviceId: "pc", days: [] }),
      JSON.stringify({ schemaVersion: "1", deviceId: "pc", days: [{ date: "2026-11-19", net: 5 }, { date: "11/19", net: 1, gross: 1 }, { date: "2026-11-18", net: 2, gross: 2 }] }),
      "<<<<<<< HEAD",
    ];
    for (const text of cases) {
      let theirs: unknown;
      try {
        theirs = main.parseDeviceWritingStats(JSON.parse(text))?.days.map((d) => ({ date: d.date, net: d.net }));
      } catch {
        theirs = undefined;
      }
      const ours = parseWritingStatsFile(text)?.slice().sort((a, b) => a.date.localeCompare(b.date));
      expect(ours).toEqual(theirs);
    }
  });
});
