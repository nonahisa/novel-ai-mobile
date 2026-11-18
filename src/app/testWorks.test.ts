import { describe, expect, it } from "vitest";
import { pickTestWorkFolders } from "./testWorks";

describe("作り物の作品を片づける（試しの画面 10）", () => {
  it("works のすぐ下の、名前が _確認用 で終わるフォルダーだけを選ぶ", () => {
    expect(
      pickTestWorkFolders(["灯台守_確認用", "確認_確認用", "長編", "試し", "_確認用", "確認用", "灯台守_確認用の続き", ".novelai-drafts", "書庫/a_確認用", "雨_確認用"])
    ).toEqual(["灯台守_確認用", "確認_確認用", "雨_確認用"].sort());
  });
  it("作り物が無ければ何も選ばない", () => {
    expect(pickTestWorkFolders(["長編", "試し"])).toEqual([]);
  });
});
