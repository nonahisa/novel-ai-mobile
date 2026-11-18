import { expect, test } from "@playwright/test";
import { FAKE_WORKS, openWithWorks } from "./support/fakeWorks";

/** 下のタブ［提案］の未決の件数（設計書 4.3）。見送ると減り、0 で消える。作品は作り物（`_確認用`）だけ */
const item = (id: string, line: number) => ({
  root: "灯台守_確認用", path: "灯台守_確認用/本文/第1話 手紙.txt", id, line,
  original: "姉から手紙が届いた。", target: "姉", suggestion: "兄", reason: "誤字", confidence: "low",
});

test("［提案］のタブに未決の件数。見送ると減り、0 で消える", async ({ page }) => {
  await page.addInitScript((list) => {
    if (!sessionStorage.getItem("seeded")) {
      localStorage.setItem("novelai.proposals.typo", JSON.stringify(list));
      sessionStorage.setItem("seeded", "1");
    }
  }, [item("a", 1), item("b", 2)]);
  await openWithWorks(page, "#/works", FAKE_WORKS);
  const badge = page.locator('#tabbar [data-tab="proposals"] .tab-badge');
  await expect(badge).toHaveText("2");
  await page.locator('#tabbar [data-tab="proposals"]').click();
  await page.locator('[data-dismiss="a"]').click();
  await expect(badge).toHaveText("1");
  await page.locator('[data-dismiss="b"]').click();
  await expect(badge).toHaveCount(0);
});
