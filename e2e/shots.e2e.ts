import { mkdirSync } from "node:fs";
import { expect, test } from "@playwright/test";

/**
 * **画面の写真を撮る**（`pnpm run shots`。2026-11-12 作者「画面ショットの撮影は自動化してほしい。
 * 撮影は製品には入れないでほしい」）。
 *
 * 撮った写真は `docs/画面の写真/自動/<段と明るさ>/<画面>.png`。`docs/画面の写真/` は .gitignore にあり、
 * リポジトリには入れない。`pnpm run e2e` は `screens` のファイルだけを走らせるので、そのときは撮らない。
 */

const SCREENS: { name: string; hash: string; prepare?: string }[] = [
  { name: "01-作品", hash: "#/works" },
  { name: "02-書く", hash: "#/write" },
  { name: "03-提案", hash: "#/proposals" },
  { name: "04-ほか", hash: "#/other" },
  { name: "05-すべての機能", hash: "#/all" },
  { name: "06-縦書きの試し-縦", hash: "#/tategaki", prepare: "vertical" },
  { name: "07-縦書きの試し-横", hash: "#/tategaki", prepare: "horizontal" },
  { name: "08-動作確認ページ", hash: "#/check" },
];

for (const screen of SCREENS) {
  test(`写真：${screen.name}`, async ({ page }, info) => {
    await page.goto(`/${screen.hash}`);
    await expect(page.locator(".appbar")).toBeVisible();
    if (screen.prepare) await page.locator(`[data-orient="${screen.prepare}"]`).click();
    // 字と絵が出そろってから撮る
    await page.evaluate(() => document.fonts.ready);
    const dir = `docs/画面の写真/自動/${info.project.name}`;
    mkdirSync(dir, { recursive: true });
    // 端末の画面と同じ大きさで撮る（ページ全体で撮ると、画面の下に貼り付いたタブが途中に写る）
    await page.screenshot({ path: `${dir}/${screen.name}.png` });
  });
}
