import { expect, test } from "@playwright/test";
import { openWithWorks } from "./support/fakeWorks";

/**
 * **表示：明朝の取り寄せ**と**ライセンス**（`src/app/displayScreen.ts`。引継ぎ書 68章）。
 * 取り寄せ先は偽物（`page.route`）。本物の書体（6.2MB）はリポジトリに入れないので、ここでは「違う中身は使わない」
 * 「やめる」を見る。本物を落として使うのはエミュレーターで確かめた
 */

const FONT_URL = "https://raw.githubusercontent.com/notofonts/noto-cjk/Serif2.003/Serif/SubsetOTF/JP/NotoSerifJP-Regular.otf";
const CORS = { "access-control-allow-origin": "*" };

test.describe("表示：明朝の取り寄せ", () => {
  test("［ほか］→ 表示。取り寄せる前に大きさを示す。届いた中身が違えば使わない", async ({ page }) => {
    let asked = 0;
    await page.route(FONT_URL, (route) => {
      asked += 1;
      return route.fulfill({ headers: CORS, contentType: "application/octet-stream", body: "OTTO 作り物で、決め打ちのハッシュと違う" });
    });
    await openWithWorks(page, "#/other");
    await page.getByRole("button", { name: /^表示/ }).click();
    await expect(page).toHaveURL(/#\/display$/);
    const get = page.locator("[data-font=get]");
    await expect(get).toHaveText("取り寄せる（6.2MB）");
    expect(asked).toBe(0); // 開いただけでは落とさない
    await get.click();
    await expect(page.locator(".font-row .flag.warn")).toHaveText("届いた中身が違うので使いません");
    expect(asked).toBe(1);
    await expect(page.locator("[data-font=get]")).toBeVisible();
  });

  test("取り寄せの途中で［やめる］と、取り寄せる前に戻る", async ({ page }) => {
    await page.route(FONT_URL, () => {
      /* 答えない（落としている途中のまま） */
    });
    await openWithWorks(page, "#/display");
    await page.locator("[data-font=get]").click();
    await expect(page.locator(".font-progress")).toHaveText("0%");
    await page.locator("[data-font=stop]").click();
    await expect(page.locator("[data-font=get]")).toBeVisible();
    await expect(page.locator(".font-row .flag")).toHaveCount(0);
  });

  test("［ほか］→ ヘルプ → ライセンス に、書体の許諾の全文", async ({ page }) => {
    await openWithWorks(page, "#/other");
    await page.getByRole("button", { name: /^ライセンス/ }).click();
    await expect(page).toHaveURL(/#\/licenses$/);
    await expect(page.locator(".license-text")).toContainText("SIL OPEN FONT LICENSE Version 1.1");
    await expect(page.locator(".license-meta")).toContainText("Serif2.003");
  });
});
