import { expect, test, type Page } from "@playwright/test";
import { openWithWorks, readFakeFile } from "./support/fakeWorks";

/**
 * **幅で3段**（設計書 4.1・4.3・4.5）。狭い（600dp 未満）は原稿だけ、中（600〜840dp）は左に話の一覧 280dp、
 * 広い（840dp 以上）は 260dp。段は CSS だけで替え、原稿の欄は作り直さない。作品は作り物（`_確認用`）だけ。
 * 幅は試験の中で替えるので、1つの組（phone-light）だけで流す
 */

const FIRST = "灯台守_確認用/本文/第1話 手紙.txt";

async function openFirst(page: Page): Promise<void> {
  await openWithWorks(page, "#/works");
  await page.locator(".work-card", { hasText: "灯台守の手紙_確認用" }).click();
  await page.locator("#episodeSlot .ep").first().click();
  await expect(page.locator("#msEditor")).toBeVisible();
}

test.describe("幅で3段", () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== "phone-light", "幅は試験の中で替える");
  });

  test("狭い段は原稿だけ。中は左に 280、広いは 260 の話の一覧。開いている話に印", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await openFirst(page);
    await expect(page.locator("#msSide")).toBeHidden();
    await expect(page.locator("#sideToggle")).toBeHidden();
    await page.setViewportSize({ width: 700, height: 1000 });
    await expect(page.locator("#msSide")).toBeVisible();
    await expect(page.locator("#sideToggle")).toBeVisible();
    expect(Math.round((await page.locator("#msSide").boundingBox())!.width)).toBe(280);
    await expect(page.locator('#msSide .ep[aria-current="page"]')).toContainText("手紙");
    await page.setViewportSize({ width: 1000, height: 800 });
    expect(Math.round((await page.locator("#msSide").boundingBox())!.width)).toBe(260);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  });

  test("回転で段が変わっても、原稿の欄は作り直さず、書きかけとカーソルが残る", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await openFirst(page);
    const editor = page.locator("#msEditor");
    await editor.fill("回転の前に書いた。\n");
    await editor.evaluate((el: HTMLTextAreaElement) => {
      (el as unknown as { __mark: boolean }).__mark = true;
      el.setSelectionRange(3, 3);
    });
    await page.setViewportSize({ width: 800, height: 360 });
    await expect(page.locator("#msSide")).toBeVisible();
    expect(
      await editor.evaluate((el: HTMLTextAreaElement) => [(el as unknown as { __mark?: boolean }).__mark === true, el.value, el.selectionStart])
    ).toEqual([true, "回転の前に書いた。\n", 3]);
  });

  test("左の一覧の話を押すと、保存を済ませてその話へ移る。［一覧］で畳むと原稿が全幅、開き直しても畳んだまま", async ({ page }) => {
    await page.setViewportSize({ width: 700, height: 1000 });
    await openFirst(page);
    await page.locator("#msEditor").fill("一覧から移る前に書いた。\n");
    await page.locator("#msSide .ep", { hasText: "霧笛" }).click();
    await expect(page.locator(".appbar-title")).toContainText("第3話 霧笛");
    await expect(page.locator('#msSide .ep[aria-current="page"]')).toContainText("霧笛");
    expect(await readFakeFile(page, FIRST)).toBe("一覧から移る前に書いた。\n");

    const before = (await page.locator("#msEditor").boundingBox())!.width;
    await page.locator("#sideToggle").click();
    await expect(page.locator("#msSide")).toBeHidden();
    await expect(page.locator("#sideToggle")).toHaveAttribute("aria-pressed", "false");
    expect((await page.locator("#msEditor").boundingBox())!.width).toBeGreaterThan(before + 200);
    await page.reload();
    await expect(page.locator("#msEditor")).toBeVisible();
    await expect(page.locator("#msSide")).toBeHidden();
    await page.locator("#sideToggle").click();
    await expect(page.locator("#msSide")).toBeVisible();
  });

  // 2026-11-19 夜 作者の頼み（iPad）「話の一覧をたためるように」：上のバーの［一覧］だけでは気づきにくいので、一覧の頭にも［たたむ］
  test("一覧の頭の［たたむ］で畳み、上のバーの［一覧］で開き直す", async ({ page }) => {
    await page.setViewportSize({ width: 744, height: 1133 });
    await openFirst(page);
    const before = (await page.locator("#msEditor").boundingBox())!.width;
    await page.locator("#msSide .ms-side-fold").click();
    await expect(page.locator("#msSide")).toBeHidden();
    await expect(page.locator("#sideToggle")).toHaveAttribute("aria-pressed", "false");
    expect((await page.locator("#msEditor").boundingBox())!.width).toBeGreaterThan(before + 200);
    await page.locator("#sideToggle").click();
    await expect(page.locator("#msSide .ms-side-fold")).toBeVisible();
  });
});
