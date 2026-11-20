import { expect, test } from "@playwright/test";
import { FAKE_WORKS, openWithWorks } from "./support/fakeWorks";

/**
 * **横の板の「校正・メモ」**（2026-11-20 夜 作者の答え「本体と同じく位置の順に1列」。本体の設計書 6.40・6.96 の校正・メモパネル）。
 * 開いている話の付箋（本文の `//` の行）・AI の指摘・編集者の提案（`.aiwriter/proposals.jsonl`）を、種類で分けず本文の行の順に
 * 1列に並べる。押すとその行へ。［資料］はそのまま。作品は作り物（`_確認用`）だけ
 */
const ROOT = "灯台守_確認用";
const PATH = `${ROOT}/本文/第1話 手紙.txt`;
const BODY = "姉から手紙がが届いた。\n霧が出た。\n// 確認：灯台の高さ\n波が高い高い。\n";
const ai = (over: Record<string, unknown>) => ({ root: ROOT, path: PATH, original: "姉から手紙がが届いた。", target: "がが", suggestion: "が", reason: "衍字", confidence: "high", line: 1, id: "a1", ...over });
const editorLine = (over: Record<string, unknown>) =>
  JSON.stringify({ kind: "proposal", id: "e1", time: "2026-11-20T10:00:00Z", proposer: "編集", file: "本文/第1話 手紙.txt", line: 2, original: "霧が出た。", target: "霧", suggestion: "靄", reason: "季節に合わせて", category: "推敲", ...over });

test("付箋・AI の指摘・編集者の提案を、本文の行の順に1列。決めた提案とほかの話のものは出さない。押すとその行へ", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.addInitScript(
    (list) => {
      if (!sessionStorage.getItem("seeded")) {
        localStorage.setItem("novelai.proposals.typo", JSON.stringify(list));
        sessionStorage.setItem("seeded", "1");
      }
    },
    [ai({}), ai({ id: "a4", line: 4, original: "波が高い高い。", target: "高い高い", suggestion: "高い" }), ai({ id: "other", path: `${ROOT}/本文/第3話 霧笛.txt`, line: 1, original: "霧が出た。", target: "霧", suggestion: "靄" })]
  );
  const ledger = [
    editorLine({}),
    editorLine({ id: "e-done", line: 1, target: "姉", suggestion: "兄" }),
    JSON.stringify({ kind: "decision", proposalId: "e-done", time: "2026-11-20T11:00:00Z", decidedBy: "作者", status: "rejected", note: "" }),
    editorLine({ id: "e-other", file: "本文/第3話 霧笛.txt", line: 1 }),
    "壊れた行",
  ].join("\n");
  await openWithWorks(page, "#/works", { ...FAKE_WORKS, [PATH]: BODY, [`${ROOT}/.aiwriter/proposals.jsonl`]: `${ledger}\n` });
  await page.locator(".work-card", { hasText: "灯台守の手紙_確認用" }).click();
  await page.locator(".ep-list .ep").first().click();
  const editor = page.locator("textarea#msEditor");
  await expect(editor).toHaveValue(BODY);
  await page.locator("#boardToggle").click();
  await expect(page.locator('[data-board-tab="proposals"]')).toHaveText("校正・メモ");
  await expect(page.locator('[data-board-tab="term"]')).toHaveText("資料");
  const rows = page.locator("#msBoardBody .note-row");
  await expect(rows).toHaveCount(4);
  expect(await rows.evaluateAll((els) => els.map((el) => `${(el as HTMLElement).dataset.noteKind}:${(el as HTMLElement).dataset.noteLine}`))).toEqual(["ai:1", "editor:2", "memo:3", "ai:4"]);
  await expect(rows.nth(1)).toContainText("霧");
  await expect(rows.nth(1)).toContainText("靄");
  await expect(rows.nth(1)).toContainText("編集者の提案");
  await expect(rows.nth(2)).toContainText("灯台の高さ");

  // 付箋を押すと、その行の頭へ
  await rows.nth(2).click();
  await expect.poll(() => editor.evaluate((el: HTMLTextAreaElement) => el.selectionStart)).toBe(BODY.indexOf("// 確認"));
  // 編集者の提案を押すと、その行の頭へ
  await rows.nth(1).click();
  await expect.poll(() => editor.evaluate((el: HTMLTextAreaElement) => el.selectionStart)).toBe(BODY.indexOf("霧が出た"));

  // 書き足した付箋も並ぶ（打ってから少しして描き直す）
  await editor.evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(el.value.length, el.value.length));
  await editor.focus();
  await page.keyboard.type("// 伏線：手紙の差出人");
  await expect(rows).toHaveCount(5);
  await expect(rows.nth(4)).toContainText("手紙の差出人");
});
