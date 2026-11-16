import { expect, test, type Page } from "@playwright/test";
import { listFakeFiles, openWithWorks, readFakeFile } from "./support/fakeWorks";

/**
 * **原稿エディター（C）の土台**（`src/app/episodeScreen.ts`。設計書 5.1〜5.4）。
 * 話の一覧から開き、打って2秒で置き場へ保存されるか・開いただけでは書かないか・離れる前に保存するかを見る。
 * 作品は作り物（`_確認用`）だけ。日本語入力は機械では起こせないので、字は `fill`・`type` で入れる。
 */

const EPISODE = "灯台守_確認用/本文/第1話 手紙.txt";
const ORIGINAL = "姉から手紙が届いた。\n// 付箋：ここは後で直す\n";

async function openEpisode(page: Page): Promise<void> {
  await openWithWorks(page, "#/works");
  await page.locator(".work-card", { hasText: "灯台守の手紙_確認用" }).click();
  await page.locator(".ep-list .ep").first().click();
  await expect(page.locator("#msEditor")).toBeVisible();
}

test.describe("原稿エディター（C）の土台", () => {
  test("開くと本文が入り、題はファイルの名前、状態は「保存済み」。下のタブは隠す。開いただけでは書かない", async ({ page }) => {
    await openEpisode(page);
    await expect(page.locator(".appbar-title")).toContainText("第1話 手紙");
    await expect(page.locator("#saveState")).toHaveText("保存済み");
    await expect(page.locator("#msEditor")).toHaveValue(ORIGINAL);
    await expect(page.locator("#tabbar")).toBeHidden();
    await page.waitForTimeout(2500);
    expect(await readFakeFile(page, EPISODE)).toBe(ORIGINAL);
    expect(await listFakeFiles(page, "灯台守_確認用/本文/.novelai-recovery")).toEqual([]);
  });

  test("打つと「保存待ち」、止めて2秒で保存して「保存済み」。最初の保存で退避を1つ取る", async ({ page }) => {
    await openEpisode(page);
    const editor = page.locator("#msEditor");
    await editor.focus();
    await editor.press("Control+End");
    await page.keyboard.type("灯台へ。");
    await expect(page.locator("#saveState")).toHaveText("保存待ち");
    await expect(page.locator("#saveState")).toHaveText("保存済み", { timeout: 5000 });
    // 末尾の改行は元の話にならって付く（本体の encodePreservingFormat）
    expect(await readFakeFile(page, EPISODE)).toBe(`${ORIGINAL}灯台へ。\n`);
    expect(await listFakeFiles(page, "灯台守_確認用/本文/.novelai-recovery")).toHaveLength(1);
    // 保存が済んだので控えは消えている
    expect(await listFakeFiles(page, ".novelai-drafts")).toEqual([]);
  });

  test("2秒たつ前に［←］で戻っても、保存を済ませてから話の一覧へ戻る", async ({ page }) => {
    await openEpisode(page);
    await page.locator("#msEditor").fill("書き直した。\n");
    await page.locator(".appbar-back").click();
    await expect(page).toHaveURL(/#\/work\//);
    await expect(page.locator(".ep-list .ep")).toHaveCount(4);
    expect(await readFakeFile(page, EPISODE)).toBe("書き直した。\n");
  });

  test("外で変わったら保存を止め、真ん中の窓で知らせる。本文は外の字のまま、書きかけは控えに残す", async ({ page }) => {
    await openEpisode(page);
    // 同期で入れ替わったことにする（置き場の記録を直に書き換える）
    await page.evaluate(async (path) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("Disc", 1);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const store = db.transaction(["FileStorage"], "readwrite").objectStore("FileStorage");
      const full = `/DATA/works/${path}`;
      const record = await new Promise<Record<string, unknown>>((resolve) => {
        const get = store.get(full);
        get.onsuccess = () => resolve(get.result as Record<string, unknown>);
      });
      record.content = btoa(String.fromCharCode(...new TextEncoder().encode("外で入れ替わった。\n")));
      store.put(record);
      db.close();
    }, EPISODE);
    await page.locator("#msEditor").fill("こちらの書きかけ。\n");
    await expect(page.locator(".dialog-message")).toHaveText(/外で変わったので、保存を止めました/, { timeout: 5000 });
    await expect(page.locator("#saveState")).toHaveText("外で変わりました");
    expect(await readFakeFile(page, EPISODE)).toBe("外で入れ替わった。\n");
    const drafts = await listFakeFiles(page, ".novelai-drafts/");
    expect(drafts).toHaveLength(1);
    expect(await readFakeFile(page, drafts[0]!)).toBe("こちらの書きかけ。\n");
    await page.locator('.dialog [data-answer="ok"]').click();
    // 戻ろうとすると訊く（書きかけは控えにある）
    await page.locator(".appbar-back").click();
    await expect(page.locator(".dialog-message")).toContainText("書きかけは端末に残っています");
    await page.locator('.dialog [data-answer="no"]').click();
    await expect(page).toHaveURL(/#\/episode\//);
  });

  test("［横で書く］で横書きへ、押し口は［縦で書く］に替わり、開き直しても覚えている", async ({ page }) => {
    await openEpisode(page);
    const editor = page.locator("#msEditor");
    await expect(editor).toHaveCSS("writing-mode", "vertical-rl");
    await page.locator("#orientToggle").click();
    await expect(editor).toHaveCSS("writing-mode", "horizontal-tb");
    await expect(page.locator("#orientToggle")).toHaveText("縦で書く");
    await page.reload();
    await expect(page.locator("#msEditor")).toHaveCSS("writing-mode", "horizontal-tb");
  });

  test("横にはみ出さない・作品の外や隠したフォルダーは開けない", async ({ page }) => {
    await openEpisode(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    for (const bad of ["#/episode/%E7%81%AF%E5%8F%B0%E5%AE%88_%E7%A2%BA%E8%AA%8D%E7%94%A8/..%2F%E5%A3%8A.txt", "#/episode/%E7%81%AF/.aiwriter%2Fconfig.txt", "#/episode/.novelai-drafts/a.txt"]) {
      await page.goto(`/${bad}`);
      await expect(page.locator("#msEditor")).toHaveCount(0);
    }
  });
});
