import { expect, test } from "@playwright/test";
import { FAKE_WORKS, openWithWorks, readFakeFile } from "./support/fakeWorks";

/**
 * **原稿エディターの右の板［提案］**（設計書 4.3。中の段は右からの引き出し、広い段は右の列）。
 * この話の指摘だけを並べ、［採る］は欄の本文を書き換え（自動保存が書く）、行を押すとその行へ。作品は作り物（`_確認用`）だけ
 */
const PATH = "灯台守_確認用/本文/第1話 手紙.txt";
const BODY = "姉から手紙がが届いた。\n霧が出た。\n";
const proposal = (over: Record<string, unknown>) => ({ root: "灯台守_確認用", path: PATH, original: "姉から手紙がが届いた。", target: "がが", suggestion: "が", reason: "衍字", confidence: "high", line: 1, id: "p1", ...over });

for (const width of [1280, 700]) {
  test(`右の板の［提案］（幅 ${width}）：この話の指摘だけ。行を押すとその行へ、［採る］で欄が直り、保存される。［見送る］で消える`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.addInitScript(
      (list) => {
        if (!sessionStorage.getItem("seeded")) {
          localStorage.setItem("novelai.proposals.typo", JSON.stringify(list));
          sessionStorage.setItem("seeded", "1");
        }
      },
      [
        proposal({}),
        proposal({ id: "p2", line: 2, original: "霧が出た。", target: "霧", suggestion: "靄", reason: "誤字" }),
        proposal({ id: "other", path: "灯台守_確認用/本文/第3話 霧笛.txt", original: "霧が出た。", target: "霧", suggestion: "靄" }),
      ]
    );
    await openWithWorks(page, "#/works", { ...FAKE_WORKS, [PATH]: BODY });
    await page.locator(".work-card", { hasText: "灯台守の手紙_確認用" }).click();
    await page.locator(".ep-list .ep").first().click();
    const editor = page.locator("textarea#msEditor");
    await expect(editor).toHaveValue(BODY);
    const board = page.locator("#msBoard");
    await expect(board).toBeHidden();
    await page.locator("#boardToggle").click();
    await expect(board).toBeVisible();
    await expect(board.locator(".proposal")).toHaveCount(2);

    await board.locator('.proposal[data-proposal="p2"] .proposal-line').click();
    await expect.poll(() => editor.evaluate((el: HTMLTextAreaElement) => el.selectionStart)).toBe(BODY.indexOf("霧"));

    await board.locator('[data-accept="p1"]').click();
    await expect(editor).toHaveValue("姉から手紙が届いた。\n霧が出た。\n");
    await expect(board.locator(".proposal")).toHaveCount(1);
    await expect(page.locator("#saveState")).toHaveText("保存済み", { timeout: 5000 });
    expect(await readFakeFile(page, PATH)).toBe("姉から手紙が届いた。\n霧が出た。\n");

    await board.locator('[data-dismiss="p2"]').click();
    await expect(board.locator(".proposal")).toHaveCount(0);
    await expect(editor).toHaveValue("姉から手紙が届いた。\n霧が出た。\n");
  });
}

test("狭い段（スマホの縦）では右の板を出さない", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await openWithWorks(page, "#/works", FAKE_WORKS);
  await page.locator(".work-card", { hasText: "灯台守の手紙_確認用" }).click();
  await page.locator(".ep-list .ep").first().click();
  await expect(page.locator("#msEditor")).toBeVisible();
  await expect(page.locator("#boardToggle")).toBeHidden();
});
