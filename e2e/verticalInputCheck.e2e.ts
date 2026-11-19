import { expect, test } from "@playwright/test";
import { FAKE_WORKS, openWithWorks } from "./support/fakeWorks";

/**
 * **打った字が本文へ届いたかの確かめ**（設計書 5.3 の2）。左の線の欄・縦書き。届かなければ知らせて［横で書く］へ案内し、
 * 自動では横へ移さない。端末に覚えて、次に開いたときに一度だけ知らせる。作品は作り物（`_確認用`）だけ
 */

async function openFirst(page: import("@playwright/test").Page): Promise<void> {
  await page.locator(".work-card", { hasText: "灯台守の手紙_確認用" }).click();
  await page.locator(".ep-list .ep").first().click();
  await expect(page.locator("textarea#msEditor")).toBeVisible();
}

test("本物の変換で届いた字には何も言わない", async ({ page }) => {
  await openWithWorks(page, "#/works", FAKE_WORKS);
  await openFirst(page);
  const editor = page.locator("textarea#msEditor");
  await editor.click();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.imeSetComposition", { text: "ねこ", selectionStart: 2, selectionEnd: 2 });
  await cdp.send("Input.insertText", { text: "猫" });
  await expect(editor).toHaveValue(/猫/);
  await page.waitForTimeout(300);
  await expect(page.locator("#toast")).not.toHaveText("この端末では縦書きの入力が崩れることがあります。横で書くと確実です");
  await expect(page.locator("#orientToggle")).not.toHaveClass(/orient-hint/);
});

test("確定した字が届かなければ知らせて［横で書く］を光らせる（横へは移さない）。次に開いたときに一度だけ知らせる", async ({ page }) => {
  await openWithWorks(page, "#/works", FAKE_WORKS);
  await openFirst(page);
  const editor = page.locator("textarea#msEditor");
  await editor.click();
  // 日本語入力が「猫」を確定したと言うのに、本文に字が入らなかった（崩れた端末の形）
  await editor.evaluate((el) => {
    el.dispatchEvent(new CompositionEvent("compositionstart", { data: "" }));
    el.dispatchEvent(new CompositionEvent("compositionend", { data: "猫" }));
  });
  await expect(page.locator("#toast")).toHaveText("この端末では縦書きの入力が崩れることがあります。横で書くと確実です");
  await expect(page.locator("#orientToggle")).toHaveClass(/orient-hint/);
  await expect(editor).toHaveCSS("writing-mode", "vertical-rl");

  // 開き直すと、一度だけ知らせる
  await page.reload();
  await page.evaluate(() => (location.hash = "#/works"));
  await openFirst(page);
  await expect(page.locator("#toast")).toHaveText("この端末では、前に縦書きの入力が崩れました。崩れたら［横で書く］で横書きにできます");
});
