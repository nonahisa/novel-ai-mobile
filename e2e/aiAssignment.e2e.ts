import { expect, test } from "@playwright/test";
import { openWithWorks } from "./support/fakeWorks";

/**
 * **設定 → AI の割り当て**（`src/platform/aiAssignment.ts`。引継ぎ書 74章）。鍵は作り物、Anthropic は偽物
 */

const FAKE = "sk-ant-tukurimono-assign";

test.describe("機能ごとの AI の割り当て", () => {
  test("鍵のある AI からモデルを選び、既定と機能に割り当てる。既定のままに戻せる。鍵を消すと既定で動くと出す", async ({ page }) => {
    let listed = 0;
    await page.route("https://api.anthropic.com/v1/models**", (route) => {
      listed += 1;
      return route.fulfill({
        headers: { "access-control-allow-origin": "*" },
        contentType: "application/json",
        body: JSON.stringify({ data: [{ id: "claude-a" }, { id: "claude-b" }] }),
      });
    });
    await openWithWorks(page, "#/ai");
    await expect(page.locator(".ai-features .ep")).toHaveCount(12);
    await expect(page.locator("#aiDefault")).toContainText("選んでいません");

    // 鍵が無ければ選べない
    await page.locator("[data-ai-default]").click();
    await expect(page.locator("#toast")).toHaveText("先に APIキーを登録してください");

    await page.locator('[data-ai-set="claude"]').click();
    await page.locator("#dialogInput").fill(FAKE);
    await page.locator('[data-answer="yes"]').click();
    await expect(page.locator('.ai-row[data-provider="claude"] .flag.ok')).toHaveText("登録済み");

    await page.locator("[data-ai-default]").click();
    await expect(page.locator(".dialog-list [data-choice]")).toHaveText(["Claude（クラウド・有料）"]);
    await page.locator('[data-choice="claude"]').click();
    await expect(page.locator(".dialog-list [data-choice]")).toHaveText(["claude-a", "claude-b"]);
    await page.locator('[data-choice="claude-b"]').click();
    await expect(page.locator("#aiDefault")).toContainText("Claude・claude-b");
    await expect(page.locator("#toast")).toHaveText("実行のたびに課金されます（実行前に目安を表示します）。");

    const typo = page.locator('[data-ai-feature="typo"]');
    await expect(typo).toContainText("既定のまま");
    await typo.click();
    await expect(page.locator(".dialog-list [data-choice]")).toHaveText(["既定のまま", "Claude（クラウド・有料）"]);
    await page.locator('[data-choice="claude"]').click();
    await page.locator('[data-choice="claude-a"]').click();
    await expect(typo).toContainText("Claude・claude-a");
    expect(listed).toBe(1); // モデルの一覧は1回だけ訊く

    // 鍵を消すと、割り当ては残したまま、既定で動くと出す
    await page.locator('[data-ai-remove="claude"]').click();
    await page.locator('[data-answer="yes"]').click();
    await expect(typo).toContainText("鍵が無いので既定で動きます");

    // 既定のままに戻す（鍵を入れ直して）
    await page.locator('[data-ai-set="claude"]').click();
    await page.locator("#dialogInput").fill(FAKE);
    await page.locator('[data-answer="yes"]').click();
    await typo.click();
    await page.locator('[data-choice="default"]').click();
    await expect(typo).toContainText("既定のまま");
  });
});
