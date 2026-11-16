import { expect, test } from "@playwright/test";
import { openWithWorks } from "./support/fakeWorks";

/** 有料の AI へ送る前の確認の窓（`src/app/paidConfirm.ts`。引継ぎ書 72章）。見本は動作確認ページの 8。どこにも送らない */

test.describe("有料の AI へ送る前の確認の窓", () => {
  test("本体の文言の3行・［詳しく］・［実行］［やめる］。端末の［戻る］キーはやめる（動作確認ページの見本。送らない）", async ({ page }) => {
    let sent = 0;
    await page.route("https://api.anthropic.com/**", (route) => {
      sent += 1;
      return route.abort();
    });
    await openWithWorks(page, "#/check");
    await page.locator("#paidConfirm").click();
    const dialog = page.locator(".paid-confirm");
    await expect(dialog.locator(".dialog-title")).toHaveText("誤字脱字を実行しますか");
    await expect(dialog.locator(".paid-lines li")).toHaveText(["Claude（有料）で送ります", "送るもの：本文 約4,321字（1話）", "料金：AIを 1 回呼びます。使った量だけかかります"]);
    await expect(page.locator(".paid-confirm [data-answer=no]")).toBeFocused();
    await expect(dialog.locator(".paid-more li").first()).toBeHidden();
    await dialog.locator(".paid-more summary").click();
    await expect(dialog.locator(".paid-more li").first()).toHaveText("使うモデル：（見本のモデル）");
    await page.evaluate(() => document.dispatchEvent(new Event("backbutton")));
    await expect(page.locator("#paidResult")).toHaveText("［やめる］を選びました");
    await page.locator("#paidConfirm").click();
    await page.locator(".paid-confirm [data-answer=yes]").click();
    await expect(page.locator("#paidResult")).toHaveText("［実行］を選びました（送っていません）");
    expect(sent).toBe(0);
  });
});
