import { describe, expect, test } from "vitest";
import { applyFailureText, renderConflictView, theirsQuestion } from "../src/app/conflictScreen";
import { renderSyncScreen } from "../src/app/syncScreen";
import { conflictHash, parseRoute } from "../src/app/shell";
import type { ConflictMaterial } from "../src/platform/syncConflict";

/** 競合を選ぶ画面（`src/app/conflictScreen.ts`。引継ぎ書 60章）。作品は作り物（`_確認用`）だけ */

const visibleText = (html: string) => html.replace(/<[^>]+>/g, "");

const side = (text: string, exists = true) => ({ exists, text, oid: exists ? "x" : null });
const material = (ours: string, theirs: string, choices: ConflictMaterial["choices"] = ["ours", "theirs", "both"]): ConflictMaterial => ({
  path: "本文/第1話 手紙.txt",
  theirsCommit: "c",
  ours: side(ours),
  theirs: side(theirs),
  base: side("もと\n"),
  choices,
});

describe("競合を選ぶ画面", () => {
  test("［こちら｜あちら］で見る文を替え、もう片方に無い行に印。選ぶボタンは出してよいものだけ", () => {
    const m = material("同じ行\nこちらの行\n", "同じ行\nあちらの<行>\n");
    const ours = renderConflictView(m, "ours");
    expect(ours).toContain(`data-cf-view="ours" aria-pressed="true"`);
    expect(ours).toContain(`<span class="cf-line">同じ行</span><span class="cf-line cf-diff">こちらの行</span>`);
    expect(visibleText(ours)).toContain("こちらを残すあちらにする両方残す");
    const theirs = renderConflictView(m, "theirs");
    expect(theirs).toContain(`<span class="cf-line cf-diff">あちらの&lt;行&gt;</span>`);
    expect(renderConflictView(material("a\n", "b\n", ["ours", "theirs"]), "ours")).not.toContain("両方残す");
  });

  test("消した側は「消した」。［あちらにする］の確かめは、消える・消す・戻すで言い分ける", () => {
    const deleted: ConflictMaterial = { ...material("こちら\n", ""), theirs: side("", false), choices: ["ours", "theirs"] };
    expect(visibleText(renderConflictView(deleted, "theirs"))).toContain("消した");
    expect(theirsQuestion(deleted)).toEqual({ message: "あちらでは、この話を消しました。\nこの端末からも消します", yes: "消す" });
    expect(theirsQuestion(material("a\n", "b\n")).message).toContain("こちらの文は消えます");
    expect(theirsQuestion({ ...material("", "b\n"), ours: side("", false) }).message).toContain("あちらの文で戻します");
    expect(applyFailureText({ ok: false, reason: "stale" })).toContain("［取ってくる］");
  });

  test("同期の画面に競合の話を並べ、選んだ話には選んだものの印。場所は往復できる", () => {
    const html = renderSyncScreen("灯台守_確認用", { unsent: [], otherCount: 0 }, "ready", [
      { path: "本文/第1話 手紙.txt" },
      { path: "本文/第2話 灯.txt", decision: "both" },
    ]);
    expect(visibleText(html)).toContain("競合：1話");
    expect(html).toContain(`data-conflict="本文/第1話 手紙.txt" data-root="灯台守_確認用"`);
    expect(visibleText(html)).toContain("選んでください");
    expect(visibleText(html)).toContain("両方");
    expect(visibleText(html)).not.toContain("同期済み");
    expect(parseRoute(conflictHash("灯台守_確認用", "本文/第1話 手紙.txt"))).toEqual({ kind: "conflict", root: "灯台守_確認用", path: "本文/第1話 手紙.txt" });
    expect(parseRoute("#/conflict/灯台守_確認用/..%2Fx.txt").kind).toBe("tab");
    expect(parseRoute("#/conflict/灯台守_確認用/.git%2Fconfig").kind).toBe("tab");
  });

  test("投稿の台帳を合わせる行は「印を合わせる」と出し、押せない（選ぶ画面へ行かない）。競合の数にも入れない", () => {
    const html = renderSyncScreen("灯台守_確認用", { unsent: [], otherCount: 0 }, "ready", [
      { path: "本文/第1話 手紙.txt" },
      { path: "設定/投稿状態.json", decision: "merge" },
    ]);
    expect(visibleText(html)).toContain("競合：1話");
    expect(visibleText(html)).toContain("印を合わせる");
    expect(html).not.toContain(`data-conflict="設定/投稿状態.json"`);
    expect(html).toContain(`data-merged-ledger="設定/投稿状態.json"`);
  });
});
