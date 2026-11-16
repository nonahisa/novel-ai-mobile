import { describe, expect, test } from "vitest";
import { DELETED_STORY_LABEL, renderSyncScreen } from "../src/app/syncScreen";
import { parseRoute, syncHash } from "../src/app/shell";

/** 同期の画面（G。`src/app/syncScreen.ts`）。作品は作り物（`_確認用`）だけ */

const visibleText = (html: string) => html.replace(/<[^>]+>/g, "");

describe("同期の画面", () => {
  test("送っていない話は開ける・消した話は押せない", () => {
    const html = renderSyncScreen("灯台守_確認用", {
      unsent: [
        { path: "灯台守_確認用/本文/第1話 <手紙>.txt", deleted: false, mtimeMs: 1 },
        { path: "灯台守_確認用/本文/第2話.txt", deleted: true },
      ],
      otherCount: 1,
    }, "ready");
    expect(html).toContain(`<button data-sync-run="fetch">取ってくる</button><button data-sync-run="send">送る</button>`);
    expect(html).toContain(`data-episode="灯台守_確認用/本文/第1話 &lt;手紙&gt;.txt" data-root="灯台守_確認用"`);
    expect(html).toContain(`<div class="ep" aria-disabled="true"><span class="no"></span><span class="name">第2話</span>`);
    expect(visibleText(html)).toContain("送っていない話：2");
    expect(visibleText(html)).toContain("ほかの変更：1");
    expect(visibleText(html)).toContain(DELETED_STORY_LABEL);
  });

  test("送っていなければ「同期済み」だけ。git で持っていなければ空の形", () => {
    expect(visibleText(renderSyncScreen("灯台守_確認用", { unsent: [], otherCount: 0 }, "ready"))).toBe("取ってくる送る同期済み");
    const none = renderSyncScreen("灯台守_確認用", undefined);
    expect(none).toContain("work-empty");
    expect(visibleText(none)).toBe("取ってくる送る");
    expect(none.match(/data-planned="この作品の GitHub の置き場が分かりません"/g)).toHaveLength(2);
  });

  test("［取ってくる］［送る］：サインインしていなければサインインの画面へ。置き場が分からなければ灰色。調べるあいだは押せない", () => {
    const state = { unsent: [], otherCount: 0 };
    expect(renderSyncScreen("灯台守_確認用", state, "signedOut").match(/data-screen="github"/g)).toHaveLength(2);
    expect(renderSyncScreen("灯台守_確認用", state, "noRemote").match(/data-planned=/g)).toHaveLength(2);
    const checking = renderSyncScreen("灯台守_確認用", state, "checking");
    expect(checking.match(/aria-disabled="true">/g)).toHaveLength(2);
    expect(checking).not.toContain("data-sync-run");
  });

  test("場所を往復でき、作品の外は作品一覧へ", () => {
    for (const root of ["灯台守_確認用", "書庫_確認用/港_確認用"]) expect(parseRoute(syncHash(root))).toEqual({ kind: "sync", root });
    for (const bad of ["#/sync/..%2F壊", "#/sync/.git", "#/sync/a%2Fb%2Fc", "#/sync/%E0%A4%A"]) expect(parseRoute(bad).kind).toBe("tab");
  });
});
