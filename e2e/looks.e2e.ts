import { mkdirSync, readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { openWithWorks } from "./support/fakeWorks";

/**
 * **見た目の案の写真**（2026-11-17 作者「画面配置もテスト用のものでなくてもいいかもしれません。見た目もおしゃれになるよう整えてください」）。
 * 製品には入れない（`e2e/looks/*.css` を写真のときだけ差し込む）。`pnpm exec playwright test looks` で
 * `docs/画面の写真/案/<段と明るさ>/` に撮る。作品は作り物（`_確認用`）だけ
 */

const LOOKS = ["いま", "A", "B", "C"] as const;
const css = (name: string) => readFileSync(`e2e/looks/${name}.css`, "utf8");

async function dress(page: Page, look: (typeof LOOKS)[number]): Promise<void> {
  if (look === "いま") return;
  await page.addStyleTag({ content: css("layout") + css(look.toLowerCase()) });
}

const SCREENS: { name: string; go: (page: Page) => Promise<void> }[] = [
  {
    name: "1-作品",
    go: async (page) => {
      await expect(page.locator(".work-card").first()).toBeVisible();
    },
  },
  {
    name: "2-話の一覧",
    go: async (page) => {
      await page.locator(".work-card", { hasText: "灯台守の手紙_確認用" }).click();
      await expect(page.locator(".ep-list .ep").first()).toBeVisible();
    },
  },
  {
    name: "3-原稿",
    go: async (page) => {
      await page.locator(".work-card", { hasText: "灯台守の手紙_確認用" }).click();
      await page.locator(".ep-list .ep").first().click();
      await expect(page.locator("#msEditor")).toBeVisible();
    },
  },
  {
    name: "4-書く",
    go: async (page) => {
      await page.locator(".work-card", { hasText: "灯台守の手紙_確認用" }).click();
      await page.locator(".ep-list .ep").first().click();
      await expect(page.locator("#msEditor")).toBeVisible();
      await page.evaluate(() => (location.hash = "#/write"));
      await expect(page.locator(".appbar")).toContainText("書く");
    },
  },
  {
    name: "5-ほか",
    go: async (page) => {
      await page.evaluate(() => (location.hash = "#/other"));
      await expect(page.locator(".appbar")).toContainText("ほか");
    },
  },
];

for (const look of LOOKS) {
  for (const screen of SCREENS) {
    test(`案の写真：${look}・${screen.name}`, async ({ page }, info) => {
      await openWithWorks(page, "#/works");
      await dress(page, look);
      await screen.go(page);
      await page.evaluate(() => document.fonts.ready);
      const dir = `docs/画面の写真/案/${info.project.name}`;
      mkdirSync(dir, { recursive: true });
      await page.screenshot({ path: `${dir}/${screen.name}-${look}.png` });
    });
  }
}
