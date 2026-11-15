import { describe, expect, test } from "vitest";
import { MemoryFileStore } from "../src/platform/memoryFileStore";
import { scanWorkFolder } from "../src/platform/workScan";
import { renderEpisodeList, renderWorkList } from "../src/app/workScreens";
import { NOT_BUILT_MESSAGE } from "../src/app/menuScreen";

/** 作品一覧（A）と話の一覧（B）の HTML。作品は作り物（`_確認用`）だけ */
const enc = (text: string) => new TextEncoder().encode(text);
const visibleText = (html: string) => html.replace(/<[^>]+>/g, "");

describe("作品一覧と話の一覧の HTML", () => {
  test("作品が無いときは空の形だけで、字を出さない（設計書 4.6）", () => {
    const html = renderWorkList([], new Date());
    expect(html).toContain("work-empty");
    expect(visibleText(html).trim()).toBe("");
  });

  test("話を押すと「まだ作っていません」（灰色の項目と同じ扱い）。題は字のまま出す", async () => {
    const store = new MemoryFileStore();
    store.putExternally("猫<b>_確認用/.aiwriter/config.json", enc(JSON.stringify({ workTitle: "猫<b>_確認用" })));
    store.putExternally("猫<b>_確認用/本文/第1話 <i>夜.txt", enc("猫"));
    const work = await scanWorkFolder(store, "猫<b>_確認用");
    const html = renderEpisodeList(work);
    expect(html).toContain(`class="ep" data-planned="${NOT_BUILT_MESSAGE}"`);
    expect(html).toContain("&lt;i&gt;夜");
    expect(renderWorkList([{ ok: true, work }], new Date())).toContain("猫&lt;b&gt;_確認用");
  });
});
