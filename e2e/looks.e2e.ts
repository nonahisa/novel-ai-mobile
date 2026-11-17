import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { openWithWorks } from "./support/fakeWorks";

/**
 * **見た目の案の写真**（2026-11-17 作者「画面配置もテスト用のものでなくてもいいかもしれません。見た目もおしゃれになるよう整えてください」）。
 * 2026-11-18 作者「選べるようにしてください」：案は設定 → 表示 → 見た目で選べる（`src/looks.css`）。写真は端末の覚え
 * （`novelai.look`）を替えて撮る。`pnpm exec playwright test looks` で `docs/画面の写真/案/<段と明るさ>/` に撮る
 * （iPad の大きさは wide-light で `iPad13`・`iPad11`・`iPadmini` のフォルダーへ）。作品は作り物（`_確認用`）だけ
 */

const LOOKS = { 標準: "standard", 和紙と墨: "washi", 白と藍: "hakuai", 墨と朱: "sumishu" } as const;
type LookName = keyof typeof LOOKS;
const IPADS = [
  { name: "iPad13", width: 1376, height: 1032 },
  { name: "iPad11", width: 1180, height: 820 },
  { name: "iPadmini", width: 1133, height: 744 },
];

async function dress(page: Page, look: LookName): Promise<void> {
  await page.evaluate((id) => localStorage.setItem("novelai.look", id), LOOKS[look]);
  await page.reload();
  await expect(page.locator(".appbar")).toBeVisible();
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

for (const look of Object.keys(LOOKS) as LookName[]) {
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
    for (const ipad of IPADS) {
      test(`案の写真：${ipad.name}・${look}・${screen.name}`, async ({ page }, info) => {
        test.skip(info.project.name !== "wide-light", "iPad の大きさは wide-light だけで撮る");
        await page.setViewportSize({ width: ipad.width, height: ipad.height });
        await openWithWorks(page, "#/works");
        await dress(page, look);
        await screen.go(page);
        await page.evaluate(() => document.fonts.ready);
        const dir = `docs/画面の写真/案/${ipad.name}`;
        mkdirSync(dir, { recursive: true });
        await page.screenshot({ path: `${dir}/${screen.name}-${look}.png` });
      });
    }
  }
}
