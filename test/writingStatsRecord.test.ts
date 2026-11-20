import { describe, expect, it } from "vitest";
import { MemoryFileStore } from "../src/platform/memoryFileStore";
import { createWritingRecorder, isBaselineOnlyStatsChange, statsFilePath } from "../src/platform/writingStatsRecord";
import { readWorkWritingDays } from "../src/platform/writingStatsRead";

/**
 * **この端末で書いた字数の記録**（2026-11-20 夜 作者の答え「パソコンと同じく基準も記録のファイルに」。`writingStatsRecord.ts`）。
 * 決まりは本体の `core/writingStats.ts` をそのまま使うので、ここでは流れ（開いた・保存した・取り込んだ）と、置き場の形を見る。
 * 作品は作り物（`_確認用`）だけ
 */
const ROOT = "灯台守_確認用";
const enc = (text: string) => new TextEncoder().encode(text);

async function setup(body: string) {
  const store = new MemoryFileStore();
  for (const dir of [ROOT, `${ROOT}/.aiwriter`, `${ROOT}/本文`]) await store.createDirectory(dir);
  await store.writeFile(`${ROOT}/.aiwriter/config.json`, enc(JSON.stringify({ workTitle: "灯台守の手紙_確認用" })), { mode: "create" });
  await store.writeFile(`${ROOT}/本文/第1話.txt`, enc(body), { mode: "create" });
  let clock = new Date(2026, 10, 20, 12, 0, 0);
  const recorder = createWritingRecorder({ store, deviceId: async () => "phone1", now: () => clock });
  const read = async () => JSON.parse(new TextDecoder().decode(await store.readFile(statsFilePath(ROOT, "phone1"))));
  return { store, recorder, read, setClock: (at: Date) => (clock = at) };
}

describe("この端末の字数の記録", () => {
  it("開いたときに基準を置き（数えない）、保存したら差をその日に積む。本体と同じ形のファイル", async () => {
    const { store, recorder, read } = await setup("姉から手紙が届いた。");
    await recorder.noteOpened(ROOT, `${ROOT}/本文/第1話.txt`);
    const opened = await read();
    expect(opened).toMatchObject({ schemaVersion: "1", deviceId: "phone1", days: [] });
    expect(opened.baseline.files).toEqual({ "本文/第1話.txt": { net: 10, gross: 10 } });

    await store.writeFile(`${ROOT}/本文/第1話.txt`, enc("姉から手紙が届いた。霧が出た。"), { mode: "overwrite" });
    expect(await recorder.record(ROOT)).toBe(5);
    const saved = await read();
    expect(saved.days).toEqual([expect.objectContaining({ date: "2026-11-20", net: 5, gross: 5, saves: 1 })]);
    // 統計の画面の読み方でも読める
    expect(await readWorkWritingDays(store, ROOT)).toEqual([{ date: "2026-11-20", net: 5 }]);
  });

  it("取り込んだあとは基準だけ置き直し（取り込んだ字を数えない）、その変更は基準だけの変更と見分ける", async () => {
    const { store, recorder, read } = await setup("一。");
    await recorder.record(ROOT); // 初回は基準だけ
    const before = new TextDecoder().decode(await store.readFile(statsFilePath(ROOT, "phone1")));
    // パソコンで書いた分が届いた
    await store.writeFile(`${ROOT}/本文/第1話.txt`, enc("一。パソコンで書き足した。"), { mode: "overwrite" });
    await recorder.rebaseline(ROOT);
    const after = new TextDecoder().decode(await store.readFile(statsFilePath(ROOT, "phone1")));
    expect((await read()).days).toEqual([]);
    expect(isBaselineOnlyStatsChange(before, after)).toBe(true);
    // そのあと保存しても、届いた字は数えない
    expect(await recorder.record(ROOT)).toBe(0);
  });

  it("字数が同じなら書き直さない（測った時刻だけ変わったファイルを作らない）", async () => {
    const { store, recorder, setClock } = await setup("一。");
    await recorder.record(ROOT);
    const first = await store.readFile(statsFilePath(ROOT, "phone1"));
    setClock(new Date(2026, 10, 20, 18, 0, 0));
    await recorder.rebaseline(ROOT);
    await recorder.record(ROOT);
    expect(await store.readFile(statsFilePath(ROOT, "phone1"))).toEqual(first);
  });

  it("基準だけの変更か：日の字数が変わった・端末が違う・壊れている・消えたなら違う", () => {
    const file = (days: unknown[], net: number, device = "phone1") =>
      JSON.stringify({ schemaVersion: "1", deviceId: device, days, baseline: { net, gross: net, fileCount: 1, conflictedCount: 0, measuredAt: "2026-11-20T03:00:00.000Z" } });
    const day = { date: "2026-11-20", net: 1, gross: 1, saves: 1 };
    expect(isBaselineOnlyStatsChange(file([day], 1), file([day], 9))).toBe(true);
    expect(isBaselineOnlyStatsChange(undefined, file([], 9))).toBe(true);
    expect(isBaselineOnlyStatsChange(undefined, file([day], 9))).toBe(false);
    expect(isBaselineOnlyStatsChange(file([day], 1), file([{ ...day, net: 2, gross: 2, saves: 2 }], 2))).toBe(false);
    expect(isBaselineOnlyStatsChange(file([day], 1), file([day], 9, "phone2"))).toBe(false);
    expect(isBaselineOnlyStatsChange(file([day], 1), "<<<<<<<")).toBe(false);
    expect(isBaselineOnlyStatsChange(file([day], 1), undefined)).toBe(false);
  });
});
