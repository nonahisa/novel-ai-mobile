import { describe, expect, test } from "vitest";
import { MemoMarkersConfigError } from "../src/shared";
import { MemoryFileStore } from "../src/platform/memoryFileStore";
import { WORK_CONFIG_PATH, readWorkMemoMarkers } from "../src/platform/memoMarkers";
import { countLabel } from "../src/app/tategakiDraft";

/**
 * 作品ごとのメモの印（本体 1.0.1〜。本体の設計書 6.40.8）。作品は作り物（`_確認用`）だけで試す
 */
const WORK = "作品_確認用";
const enc = (text: string) => new TextEncoder().encode(text);

function storeWithConfig(config?: string): MemoryFileStore {
  const store = new MemoryFileStore();
  if (config !== undefined) store.putExternally(`${WORK}/${WORK_CONFIG_PATH}`, enc(config));
  return store;
}

describe("作品のメモの印を読む", () => {
  test("設定が無ければ既定（// と ／／）", async () => {
    const markers = await readWorkMemoMarkers(storeWithConfig(), WORK);
    expect(markers.ids).toEqual(["slash"]);
  });

  test("選んだ印を読み、字数ではその印の行を数えない", async () => {
    const markers = await readWorkMemoMarkers(storeWithConfig(JSON.stringify({ memoMarkers: ["percent"] })), WORK);
    expect(markers.ids).toEqual(["percent"]);
    const body = "猫が鳴く\n%% ここは付箋\n";
    // 既定の印では %% の行も本文として数える。作品の印なら数えない
    expect(countLabel(body)).not.toBe(countLabel(body, markers));
    expect(countLabel(body, markers)).toBe(countLabel("猫が鳴く\n"));
  });

  test("設定の欄が壊れていれば、既定へ戻さずに止める（本体と同じ）", async () => {
    await expect(readWorkMemoMarkers(storeWithConfig(JSON.stringify({ memoMarkers: "percent" })), WORK)).rejects.toBeInstanceOf(
      MemoMarkersConfigError
    );
    await expect(readWorkMemoMarkers(storeWithConfig("{壊れた"), WORK)).rejects.toBeInstanceOf(MemoMarkersConfigError);
  });

  test("知らない印の名前は飛ばす（新しい版で増えた印があっても止まらない）", async () => {
    const markers = await readWorkMemoMarkers(storeWithConfig(JSON.stringify({ memoMarkers: ["slash", "未来の印"] })), WORK);
    expect(markers.ids).toEqual(["slash"]);
  });
});
