import { expect, test, type Page } from "@playwright/test";
import { openWithWorks } from "./support/fakeWorks";

/**
 * **キーボードが出て見える所が低いときは、上下を細くする**（`src/app/compactMode.ts`。2026-11-17 作者の答え：
 * iPad mini を横にしてキーボードを出すと、本文の枠が約130pt しか見えなかった。直しの案1）。
 * 見える所は iPad mini の横＋キーボード（1133×317）。作品は作り物（`_確認用`）だけ
 */

const SHORT = { width: 1133, height: 317 };

async function boxes(page: Page, editor: string, tools: string) {
  return page.evaluate(
    ([e, t]) => {
      const bar = document.querySelector(".appbar")!.getBoundingClientRect();
      const ed = document.querySelector(e)!.getBoundingClientRect();
      const tl = document.querySelector(t)!.getBoundingClientRect();
      const sub = document.querySelector(".appbar-title small");
      return {
        bar: bar.bottom,
        editorTop: ed.top,
        editorBottom: ed.bottom,
        editorHeight: ed.height,
        toolsTop: tl.top,
        toolsBottom: tl.bottom,
        sub: sub ? getComputedStyle(sub).display : "none",
        compact: document.documentElement.dataset.compact ?? "",
        scrollY,
      };
    },
    [editor, tools]
  );
}

test.describe("キーボードが出て見える所が低いとき（iPad mini 横）", () => {
  test.use({ viewport: SHORT });

  test("原稿エディター：上のバーは細く副題は隠れ、欄は見える高さに合い、道具帯はその下に見えている", async ({ page }) => {
    await openWithWorks(page, "#/works");
    await page.locator(".work-card", { hasText: "灯台守の手紙_確認用" }).click();
    await page.locator(".ep-list .ep").first().click();
    await expect(page.locator("#msTools")).toBeVisible();
    const b = await boxes(page, "#msEditor", "#msTools");
    expect(b.compact).toBe("on");
    expect(b.bar).toBeLessThanOrEqual(38);
    expect(b.sub).toBe("none");
    // 欄と道具帯が、見える所（317）の中に収まる
    expect(b.toolsBottom).toBeLessThanOrEqual(SHORT.height);
    expect(b.toolsTop).toBeGreaterThanOrEqual(b.editorBottom - 1);
    // 本文の欄は見える高さの6割より広い（いまの約130pt・約4割から）
    expect(b.editorHeight).toBeGreaterThan(SHORT.height * 0.6);
  });

  test("縦書き・横書きの試し（C）：欄を見える所へ送ると、細いバーの下に道具の段、そのすぐ下に欄が入りきる", async ({ page }) => {
    await page.goto("/#/tategaki");
    await expect(page.locator("#draftResult")).not.toBeEmpty();
    await page.locator('[data-mode="C"]').click();
    await expect(page.locator("#composedTools")).toBeVisible();
    // キーボードが出ると欄が見える所へ送られる（送ると道具の段が細いバーのすぐ下に張りつく）
    await page.locator(".draft-input.composed").evaluate((el) => el.scrollIntoView({ block: "end" }));
    const after = await boxes(page, ".draft-input.composed", "#composedTools");
    expect(after.compact).toBe("on");
    expect(after.bar).toBeLessThanOrEqual(38);
    // 道具の段は細いバーの下に見えていて、欄はそのすぐ下
    expect(after.toolsTop).toBeGreaterThanOrEqual(after.bar - 1);
    expect(after.toolsBottom).toBeLessThanOrEqual(after.editorTop + 1);
    expect(after.editorHeight).toBeGreaterThan(SHORT.height * 0.5);
    expect(after.editorBottom).toBeLessThanOrEqual(SHORT.height + 1);
    expect(after.editorTop).toBeGreaterThanOrEqual(after.toolsBottom - 1);
  });
});

test.describe("見える所が高いときは、いまのまま", () => {
  test.use({ viewport: { width: 1133, height: 744 } });

  test("上のバーの高さと副題は替わらない", async ({ page }) => {
    await openWithWorks(page, "#/works");
    await page.locator(".work-card", { hasText: "灯台守の手紙_確認用" }).click();
    await page.locator(".ep-list .ep").first().click();
    await expect(page.locator("#msTools")).toBeVisible();
    const b = await boxes(page, "#msEditor", "#msTools");
    expect(b.compact).toBe("");
    expect(b.bar).toBeGreaterThanOrEqual(52);
    expect(b.sub).toBe("block");
  });
});
