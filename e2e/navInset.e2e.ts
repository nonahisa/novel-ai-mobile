import { expect, test } from "@playwright/test";
import { openWithWorks } from "./support/fakeWorks";

/**
 * **横向きの Android で、右に来る操作ボタンの帯（◀ ● ■）を避ける**（引継ぎ書 151章）。
 * AQUOS を横にすると、操作ボタンの帯が画面の右に縦に並び、WebView には右の余白（safe-area-inset-right）が
 * 約 47px 来る。本文の欄は body の余白で避けていたが、右下の［＋］・知らせ・下のタブは画面の端から測っていて、
 * ［＋］が帯の裏に半分隠れた（2026-11-20 AQUOS SH-M25・0.1.134）。
 * Playwright の Chromium では env(safe-area-inset-*) が 0 なので、同じ値を持つ変数（--safe-left・--safe-right）を書き換えて試す
 */

const RIGHT = 47;
const LEFT = 26;

test.describe("横向きの右の操作ボタンの帯", () => {
  test.use({ viewport: { width: 780, height: 360 } });

  test("右下の［＋］・知らせ・下のタブの押し口は、右と左の余白の内側に収まる", async ({ page }) => {
    await openWithWorks(page, "#/works");
    await page.evaluate(
      ([r, l]) => {
        document.documentElement.style.setProperty("--safe-right", `${r}px`);
        document.documentElement.style.setProperty("--safe-left", `${l}px`);
      },
      [RIGHT, LEFT]
    );
    const width = 780;
    const fab = (await page.locator("#addWork").boundingBox())!;
    expect(fab.x + fab.width).toBeLessThanOrEqual(width - RIGHT);

    const tabs = page.locator("#tabbar .tab");
    const first = (await tabs.first().boundingBox())!;
    const last = (await tabs.last().boundingBox())!;
    expect(first.x).toBeGreaterThanOrEqual(LEFT);
    expect(last.x + last.width).toBeLessThanOrEqual(width - RIGHT);

    // 知らせ（.toast）は出ていなくても場所は決まっている
    const toast = await page.evaluate(() => {
      const t = document.querySelector(".toast") ?? document.body.appendChild(Object.assign(document.createElement("div"), { className: "toast" }));
      const r = t.getBoundingClientRect();
      return { left: r.left, right: r.right };
    });
    expect(toast.left).toBeGreaterThanOrEqual(LEFT);
    expect(toast.right).toBeLessThanOrEqual(width - RIGHT);
  });

  test("余白が無いとき（縦向き・iPhone など）は、これまでと同じ位置", async ({ page }) => {
    await openWithWorks(page, "#/works");
    const fab = (await page.locator("#addWork").boundingBox())!;
    expect(780 - (fab.x + fab.width)).toBe(16);
    const tabbar = (await page.locator("#tabbar").boundingBox())!;
    expect(tabbar.x).toBe(0);
    expect(tabbar.width).toBe(780);
  });
});
