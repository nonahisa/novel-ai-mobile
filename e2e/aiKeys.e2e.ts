import { expect, test } from "@playwright/test";
import { openWithWorks } from "./support/fakeWorks";

/**
 * **設定 → AI**（クラウドの AI の鍵。`src/app/aiScreen.ts`。引継ぎ書 71章）。
 * 鍵は作り物、相手（Anthropic）は偽物（`page.route`）。ブラウザでは鍵の置き場は手元だけ（開いているあいだ）
 */

const FAKE = "sk-ant-tukurimono-e2e-0000";

test.describe("設定 → AI", () => {
  test("［ほか］→ AI。鍵を登録すると「登録済み」。［確かめる］は頭に鍵を置いて訊き、違えばそう出す。［消す］は確かめてから", async ({ page }) => {
    const asked: Array<{ url: string; key: string | undefined }> = [];
    await page.route("https://api.anthropic.com/v1/models**", (route) => {
      asked.push({ url: route.request().url(), key: route.request().headers()["x-api-key"] });
      return route.fulfill({ status: 401, headers: { "access-control-allow-origin": "*" }, contentType: "application/json", body: "{}" });
    });
    await openWithWorks(page, "#/other");
    await page.getByRole("button", { name: "AI", exact: true }).click();
    await expect(page).toHaveURL(/#\/ai$/);
    const row = page.locator('.ai-row[data-provider="claude"]');
    await expect(row).toContainText("Claude（クラウド・有料）");

    await row.locator("[data-ai-set]").click();
    await expect(page.locator(".dialog-message")).toHaveText("ClaudeのAPIキーを入力してください");
    const input = page.locator("#dialogInput");
    await expect(input).toHaveAttribute("type", "password");
    // 途中に空白があれば、本体と同じ文言で断る
    await input.fill("sk-a b");
    await page.locator('[data-answer="yes"]').click();
    await expect(page.locator(".dialog-note")).toHaveText("APIキーの途中に空白や改行が混ざっています。貼り付け直してください。");
    await input.fill(FAKE);
    await page.locator('[data-answer="yes"]').click();
    await expect(row.locator(".flag.ok")).toHaveText("登録済み");
    expect(await page.content()).not.toContain(FAKE);

    await row.locator("[data-ai-check]").click();
    await expect(row.locator(".ai-result")).toHaveText("APIキーが違うか、使えないキーです");
    expect(asked).toHaveLength(1);
    expect(asked[0]!.url).not.toContain(FAKE);
    expect(asked[0]!.key).toBe(FAKE);

    await row.locator("[data-ai-remove]").click();
    await expect(page.locator(".dialog-message")).toContainText("この端末からClaudeのAPIキーを消します");
    await page.locator('[data-answer="yes"]').click();
    await expect(row.locator(".flag.ok")).toHaveCount(0);
    await expect(row.locator("[data-ai-set]")).toHaveText("登録");
  });
});
