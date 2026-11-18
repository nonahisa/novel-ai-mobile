import { expect, test } from "@playwright/test";
import { FAKE_WORKS, openWithWorks } from "./support/fakeWorks";

/**
 * **一覧の項目の長押し**（`src/app/longPress.ts`。話の長押し → 誤字脱字・推敲・あらすじ。設計書 4.4）の見張り。
 * 押したまま動かしたら（一覧を送っている）出さない・右押し（Android の長押しの contextmenu）でも出す・競合の話には出さない
 */
async function openWork(page: import("@playwright/test").Page) {
  await openWithWorks(page, "#/works", FAKE_WORKS);
  await page.locator(".work-card", { hasText: "灯台守の手紙_確認用" }).click();
  await expect(page.locator(".ep-list .ep").first()).toBeVisible();
}

test("押したまま指を動かしたら、長押しにしない（一覧を送っている）", async ({ page }) => {
  await openWork(page);
  const box = (await page.locator(".ep-list .ep").first().boundingBox())!;
  await page.mouse.move(box.x + 20, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 20, box.y + box.height / 2 + 30, { steps: 3 });
  await page.waitForTimeout(700);
  await page.mouse.up();
  await expect(page.locator(".dialog-choices")).toHaveCount(0);
});

test("右押し（Android の長押しで来る contextmenu）でも、その話の手が出る。1回だけ", async ({ page }) => {
  await openWork(page);
  await page.locator(".ep-list .ep").first().click({ button: "right" });
  await expect(page.locator(".dialog-choices")).toHaveCount(1);
  await expect(page.locator(".dialog-choices button")).toContainText(["誤字脱字", "推敲", "あらすじ"]);
  await expect(page).not.toHaveURL(/#\/episode\//);
});

test("競合の話（押しても開けない話）には出さない", async ({ page }) => {
  await openWork(page);
  const conflicted = page.locator(".ep-list .ep", { hasText: "港" });
  const box = (await conflicted.boundingBox())!;
  await page.mouse.move(box.x + 20, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(700);
  await page.mouse.up();
  await expect(page.locator(".dialog-choices")).toHaveCount(0);
});
