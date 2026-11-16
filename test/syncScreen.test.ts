import { describe, expect, test } from "vitest";
import { DELETED_STORY_LABEL, renderSyncScreen } from "../src/app/syncScreen";
import { parseRoute, syncHash } from "../src/app/shell";

/** 同期の画面（G。`src/app/syncScreen.ts`）。作品は作り物（`_確認用`）だけ */

const visibleText = (html: string) => html.replace(/<[^>]+>/g, "");

describe("同期の画面", () => {
  test("［取ってくる］［送る］は作るまで灰色。送っていない話は開ける・消した話は押せない", () => {
    const html = renderSyncScreen("灯台守_確認用", {
      unsent: [
        { path: "灯台守_確認用/本文/第1話 <手紙>.txt", deleted: false, mtimeMs: 1 },
        { path: "灯台守_確認用/本文/第2話.txt", deleted: true },
      ],
      otherCount: 1,
    });
    expect(html.match(/aria-disabled="true" data-planned=/g)).toHaveLength(2);
    expect(html).toContain(`data-episode="灯台守_確認用/本文/第1話 &lt;手紙&gt;.txt" data-root="灯台守_確認用"`);
    expect(html).toContain(`<div class="ep" aria-disabled="true"><span class="no"></span><span class="name">第2話</span>`);
    expect(visibleText(html)).toContain("送っていない話：2");
    expect(visibleText(html)).toContain("ほかの変更：1");
    expect(visibleText(html)).toContain(DELETED_STORY_LABEL);
  });

  test("送っていなければ「同期済み」だけ。git で持っていなければ空の形", () => {
    expect(visibleText(renderSyncScreen("灯台守_確認用", { unsent: [], otherCount: 0 }))).toBe("取ってくる未送る未同期済み");
    const none = renderSyncScreen("灯台守_確認用", undefined);
    expect(none).toContain("work-empty");
    expect(visibleText(none)).toBe("取ってくる未送る未");
  });

  test("場所を往復でき、作品の外は作品一覧へ", () => {
    for (const root of ["灯台守_確認用", "書庫_確認用/港_確認用"]) expect(parseRoute(syncHash(root))).toEqual({ kind: "sync", root });
    for (const bad of ["#/sync/..%2F壊", "#/sync/.git", "#/sync/a%2Fb%2Fc", "#/sync/%E0%A4%A"]) expect(parseRoute(bad).kind).toBe("tab");
  });
});
