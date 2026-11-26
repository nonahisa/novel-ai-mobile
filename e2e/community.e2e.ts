import { expect, test } from "@playwright/test";
import { openWithWorks } from "./support/fakeWorks";

/**
 * ［ほか］→ ヘルプ → コミュニティ（Discord）（2026-11-26 作者の答え「A ヘルプに Discord を足す」）。
 * 押すと、決まった1つの招待の URL を端末のブラウザで開く（URL は本体の `COMMUNITY_DISCORD_URL`）。
 * 試験では外へ出ないように、その URL への行き来を止めて、どこへ行こうとしたかだけを見る
 */
const DISCORD = "https://discord.gg/6pcuUaCMax";

test.describe("コミュニティ（Discord）", () => {
  test("［ほか］→ ヘルプ に出て、押すと招待の URL を開く。作品や原稿は送らない", async ({ page }) => {
    const asked: { url: string; method: string; body: string | null }[] = [];
    await page.route("https://discord.gg/**", (route) => {
      const request = route.request();
      asked.push({ url: request.url(), method: request.method(), body: request.postData() });
      return route.fulfill({ contentType: "text/html", body: "<title>Discord</title>" });
    });
    await openWithWorks(page, "#/other");
    const help = page.locator(".menu-section", { has: page.locator("h2", { hasText: "ヘルプ" }) });
    const link = help.getByRole("link", { name: "コミュニティ（Discord）" });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute("href", DISCORD);
    // 項目の字に下線を付けない（ほかの札と同じ見た目）
    expect(await link.evaluate((el) => getComputedStyle(el).textDecorationLine)).toBe("none");
    await link.click();
    await expect.poll(() => asked.length).toBe(1);
    expect(asked[0]).toEqual({ url: DISCORD, method: "GET", body: null });
  });

  test("すべての機能の「コミュニティ」も、同じ1つの URL を開く（灰色にしない）", async ({ page }) => {
    await openWithWorks(page, "#/all");
    const row = page.locator("#actionRows a.menu-item", { hasText: "コミュニティ" });
    await expect(row).toHaveCount(1);
    await expect(row).toHaveAttribute("href", DISCORD);
    await expect(page.locator("#actionRows .menu-item.planned", { hasText: "コミュニティ" })).toHaveCount(0);
    // 外の URL を開く項目は、この1つだけ
    const hrefs = await page.locator("#actionRows a[href^='http']").evaluateAll((els) => els.map((el) => el.getAttribute("href")));
    expect(hrefs).toEqual([DISCORD]);
  });
});
