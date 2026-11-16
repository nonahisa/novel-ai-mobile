import { describe, expect, test } from "vitest";
import { MemoryFileStore } from "../src/platform/memoryFileStore";
import { scanWorkFolder } from "../src/platform/workScan";
import { CONFLICTED_EPISODE_MESSAGE, renderEpisodeList, renderWorkList } from "../src/app/workScreens";
import { episodeHash, parseRoute } from "../src/app/shell";

/** 作品一覧（A）と話の一覧（B）の HTML。作品は作り物（`_確認用`）だけ */
const enc = (text: string) => new TextEncoder().encode(text);
const visibleText = (html: string) => html.replace(/<[^>]+>/g, "");

describe("作品一覧と話の一覧の HTML", () => {
  test("作品が無いときは空の形だけで、字を出さない（設計書 4.6）", () => {
    const html = renderWorkList([], new Date());
    expect(html).toContain("work-empty");
    expect(visibleText(html).trim()).toBe("");
  });

  test("話には開く場所（置き場の根から）と作品を持たせる。題は字のまま出す", async () => {
    const store = new MemoryFileStore();
    store.putExternally("猫<b>_確認用/.aiwriter/config.json", enc(JSON.stringify({ workTitle: "猫<b>_確認用" })));
    store.putExternally("猫<b>_確認用/本文/第1話 <i>夜.txt", enc("猫"));
    const work = await scanWorkFolder(store, "猫<b>_確認用");
    const html = renderEpisodeList(work);
    expect(html).toContain(`class="ep" data-episode="猫&lt;b&gt;_確認用/本文/第1話 &lt;i&gt;夜.txt" data-root="猫&lt;b&gt;_確認用"`);
    expect(html).toContain("&lt;i&gt;夜");
    expect(renderWorkList([{ ok: true, work }], new Date())).toContain("猫&lt;b&gt;_確認用");
  });

  test("競合の印のある話は開かせない（押すと理由だけ）", async () => {
    const store = new MemoryFileStore();
    store.putExternally("港_確認用/.aiwriter/config.json", enc("{}"));
    store.putExternally("港_確認用/本文/第1話.txt", enc("<<<<<<< ours\n船\n=======\n舟\n>>>>>>> theirs\n"));
    const html = renderEpisodeList(await scanWorkFolder(store, "港_確認用"));
    expect(html).toContain(`class="ep" aria-disabled="true" data-planned="${CONFLICTED_EPISODE_MESSAGE}"`);
    expect(html).not.toContain("data-episode");
  });
});

describe("原稿エディターの場所", () => {
  test("作品と話の場所を往復できる（書庫の中の作品も）", () => {
    for (const [root, path] of [
      ["灯台守_確認用", "灯台守_確認用/本文/第1話 手紙.txt"],
      ["書庫_確認用/港_確認用", "書庫_確認用/港_確認用/本文/第2話.txt"],
    ] as const) {
      expect(parseRoute(episodeHash(root, path))).toEqual({ kind: "episode", root, path });
    }
  });

  test("作品の外・隠したフォルダー・.txt でないものは開かない（作品一覧へ）", () => {
    for (const hash of [
      `#/episode/${encodeURIComponent("灯台守_確認用")}/${encodeURIComponent("../壊.txt")}`,
      `#/episode/${encodeURIComponent("灯台守_確認用")}/${encodeURIComponent(".aiwriter/config.txt")}`,
      `#/episode/${encodeURIComponent("灯台守_確認用")}/${encodeURIComponent("本文/.novelai-recovery/a.txt")}`,
      `#/episode/${encodeURIComponent(".novelai-drafts")}/a.txt`,
      `#/episode/${encodeURIComponent("灯台守_確認用")}/${encodeURIComponent("設定/章立て.json")}`,
      "#/episode/a/b/c.txt",
      "#/episode/%E0%A4%A/a.txt",
    ]) {
      expect(parseRoute(hash).kind).toBe("tab");
    }
    expect(() => episodeHash("灯台守_確認用", "ほか_確認用/本文/第1話.txt")).toThrow();
  });
});
