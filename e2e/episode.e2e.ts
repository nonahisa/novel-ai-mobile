import { expect, test, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import { FAKE_WORKS, listFakeFiles, openWithWorks, readFakeFile } from "./support/fakeWorks";

/**
 * **原稿エディター（C）の土台**（`src/app/episodeScreen.ts`。設計書 5.1〜5.4）。
 * 話の一覧から開き、打って2秒で置き場へ保存されるか・開いただけでは書かないか・離れる前に保存するかを見る。
 * 作品は作り物（`_確認用`）だけ。日本語入力は機械では起こせないので、字は `fill`・`type` で入れる。
 */

const EPISODE = "灯台守_確認用/本文/第1話 手紙.txt";
const ORIGINAL = "姉から手紙が届いた。\n// 付箋：ここは後で直す\n";

/** 同期で入れ替わったことにする（置き場の記録を直に書き換える） */
async function replaceExternally(page: Page, text: string): Promise<void> {
  await page.evaluate(
    async ({ path, text }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("Disc", 1);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const store = db.transaction(["FileStorage"], "readwrite").objectStore("FileStorage");
      const record = await new Promise<Record<string, unknown>>((resolve) => {
        const get = store.get(`/DATA/works/${path}`);
        get.onsuccess = () => resolve(get.result as Record<string, unknown>);
      });
      record.content = btoa(String.fromCharCode(...new TextEncoder().encode(text)));
      store.put(record);
      db.close();
    },
    { path: EPISODE, text }
  );
}

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
    // 話の一覧（B）の行で待つ（原稿エディターの左の一覧〔中・広い段。狭い段では隠す〕にも同じ行があるので、#episodeSlot で絞る）
    await expect(page.locator("#episodeSlot .ep")).toHaveCount(4);
    expect(await readFakeFile(page, EPISODE)).toBe("書き直した。\n");
  });

  test("外で変わって書きかけと重なれば、重なった所を選ぶ画面。［やめる］なら保存を止めたまま、本文は外の字・書きかけは控えに残す", async ({ page }) => {
    await openEpisode(page);
    await replaceExternally(page, "外で入れ替わった。\n");
    await page.locator("#msEditor").fill("こちらの書きかけ。\n");
    await expect(page.locator(".merge-title")).toHaveText("外の変更と、書きかけが重なった所：1", { timeout: 5000 });
    await expect(page.locator(".merge-side")).toHaveCount(2);
    await expect(page.locator("[data-merge-save]")).toBeDisabled();
    await page.locator("[data-merge-cancel]").click();
    await expect(page.locator("#saveState")).toHaveText("外で変わりました");
    expect(await readFakeFile(page, EPISODE)).toBe("外で入れ替わった。\n");
    const drafts = await listFakeFiles(page, ".novelai-drafts/");
    expect(drafts).toHaveLength(1);
    // 頭の1行はもとの本文のハッシュ（開き直したとき、本文が変わったかを見る）
    expect(await readFakeFile(page, drafts[0]!)).toMatch(/^#novelai-draft base=[0-9a-f]{64}\nこちらの書きかけ。\n$/);
    // 戻ろうとすると訊く（書きかけは控えにある）
    await page.locator(".appbar-back").click();
    await expect(page.locator(".dialog-message")).toContainText("書きかけは端末に残っています");
    await page.locator('.dialog [data-answer="no"]').click();
    await expect(page).toHaveURL(/#\/episode\//);
  });

  test("重なった所で［あちら］を選んで［合わせて保存］：合わせた本文を保存し、入れ替わった本文は退避に、控えは消える", async ({ page }) => {
    await openEpisode(page);
    await replaceExternally(page, "外で入れ替わった。\n");
    await page.locator("#msEditor").fill("こちらの書きかけ。\n");
    await page.locator('[data-merge-pick="theirs"]').click();
    await expect(page.locator('[data-merge-pick="theirs"]')).toHaveAttribute("aria-pressed", "true");
    await page.locator("[data-merge-save]").click();
    await expect(page.locator("#toast")).toHaveText("選んだとおりに合わせて保存しました");
    await expect(page.locator("#saveState")).toHaveText("保存済み");
    await expect(page.locator("#msEditor")).toHaveValue("外で入れ替わった。\n");
    expect(await readFakeFile(page, EPISODE)).toBe("外で入れ替わった。\n");
    const recoveries = await listFakeFiles(page, "灯台守_確認用/本文/.novelai-recovery");
    expect(recoveries).toHaveLength(1);
    expect(await readFakeFile(page, recoveries[0]!)).toBe("外で入れ替わった。\n");
    expect(await listFakeFiles(page, ".novelai-drafts/")).toEqual([]);
  });

  test("外の変更と書きかけが重ならなければ、黙って両方を合わせて保存する", async ({ page }) => {
    await openEpisode(page);
    // もとの本文は2行（「姉から手紙が届いた。」「// 付箋：ここは後で直す」）。こちらは1行目を変え、あちらは3行目を足す。
    // 間に変わっていない2行目があるので重ならない（隣り合う行の変更は git と同じく「同じ場所」になる）
    await replaceExternally(page, "姉から手紙が届いた。\n// 付箋：ここは後で直す\n妹からも届いた。\n");
    await page.locator("#msEditor").fill("姉から長い手紙が届いた。\n// 付箋：ここは後で直す\n");
    await expect(page.locator("#toast")).toHaveText("外の変更と合わせて保存しました", { timeout: 5000 });
    await expect(page.locator("#msEditor")).toHaveValue("姉から長い手紙が届いた。\n// 付箋：ここは後で直す\n妹からも届いた。\n");
    expect(await readFakeFile(page, EPISODE)).toBe("姉から長い手紙が届いた。\n// 付箋：ここは後で直す\n妹からも届いた。\n");
    await expect(page.locator(".merge-backdrop")).toHaveCount(0);
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

  test("［横で書く］を押しても欄の焦点とカーソルは外れない（キーボードが閉じず、そのまま続けて打てる）", async ({ page }) => {
    // 2026-11-19 AQUOS（SH-M25）0.1.116：変換中に［横で書く］を押すと、字と位置は残ったが、焦点が押し口へ移りキーボードが閉じた
    await openEpisode(page);
    const editor = page.locator("#msEditor");
    await editor.click();
    await editor.evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(3, 3));
    await page.locator("#orientToggle").click();
    await expect(editor).toHaveCSS("writing-mode", "horizontal-tb");
    await expect(editor).toBeFocused();
    expect(await editor.evaluate((el: HTMLTextAreaElement) => el.selectionStart)).toBe(3);
    await page.keyboard.type("長い");
    await expect(editor).toHaveValue(/^姉から長い手紙/);
  });

  test.describe("止められる前の書きかけ（本文が変わったときだけ訊く）", () => {
    const journal = `.novelai-drafts/${createHash("sha256").update(EPISODE).digest("hex")}.txt`;
    const DRAFT = "姉から手紙が届いた。止められる前の字。\n";
    const withJournal = (raw: string) => ({ ...FAKE_WORKS, [journal]: raw });
    const sha = (text: string) => createHash("sha256").update(text).digest("hex");

    test("本文が同じなら訊かずに戻す", async ({ page }) => {
      await openWithWorks(page, "#/works", withJournal(`#novelai-draft base=${sha(ORIGINAL)}\n${DRAFT}`));
      await page.locator(".work-card", { hasText: "灯台守の手紙_確認用" }).click();
      await page.locator(".ep-list .ep").first().click();
      await expect(page.locator("#msEditor")).toHaveValue(DRAFT);
      await expect(page.locator(".dialog-backdrop")).toHaveCount(0);
      await expect(page.locator("#toast")).toHaveText("保存していない書きかけを戻しました");
    });

    test("本文が変わっていたら訊く。［書きかけを戻す］で戻す", async ({ page }) => {
      await openWithWorks(page, "#/works", withJournal(`#novelai-draft base=${sha("前の本文\n")}\n${DRAFT}`));
      await page.locator(".work-card", { hasText: "灯台守の手紙_確認用" }).click();
      await page.locator(".ep-list .ep").first().click();
      await expect(page.locator(".dialog-message")).toContainText("この話がほかで変わっています");
      await expect(page.locator('.dialog [data-answer="no"]')).toHaveText("書きかけを戻す");
      await expect(page.locator('.dialog [data-answer="no"]')).toBeFocused();
      await page.locator('.dialog [data-answer="no"]').click();
      await expect(page.locator("#msEditor")).toHaveValue(DRAFT);
    });

    test("［戻さない］なら本文のまま、控えを消す", async ({ page }) => {
      await openWithWorks(page, "#/works", withJournal(DRAFT));
      await page.locator(".work-card", { hasText: "灯台守の手紙_確認用" }).click();
      await page.locator(".ep-list .ep").first().click();
      await page.locator('.dialog [data-answer="yes"]', { hasText: "戻さない" }).click();
      await expect(page.locator("#msEditor")).toHaveValue(ORIGINAL);
      await expect(page.locator("#saveState")).toHaveText("保存済み");
      expect(await listFakeFiles(page, ".novelai-drafts/")).toEqual([]);
      expect(await readFakeFile(page, EPISODE)).toBe(ORIGINAL);
    });
  });

  test.describe("道具帯（設計書 5.6）", () => {
    const caret = (page: Page, start: number, end = start) =>
      page.locator("#msEditor").evaluate((el, [s, e]) => {
        const area = el as HTMLTextAreaElement;
        area.focus();
        area.setSelectionRange(s!, e!);
      }, [start, end]);
    const tool = (page: Page, label: string) => page.locator("#msTools button", { hasText: label });

    test("――・「」を入れ、取り消し・やり直しで戻る。保存もされる", async ({ page }) => {
      await openEpisode(page);
      await expect(tool(page, "取り消し")).toBeDisabled();
      await caret(page, 9);
      await tool(page, "――").click();
      await expect(page.locator("#msEditor")).toHaveValue("姉から手紙が届いた――。\n// 付箋：ここは後で直す\n");
      await tool(page, "「」").click();
      await page.keyboard.type("来た");
      await expect(page.locator("#msEditor")).toHaveValue("姉から手紙が届いた――「来た」。\n// 付箋：ここは後で直す\n");
      await tool(page, "取り消し").click();
      await expect(page.locator("#msEditor")).toHaveValue("姉から手紙が届いた――「」。\n// 付箋：ここは後で直す\n");
      await tool(page, "取り消し").click();
      await expect(page.locator("#msEditor")).toHaveValue("姉から手紙が届いた――。\n// 付箋：ここは後で直す\n");
      await tool(page, "やり直し").click();
      await expect(page.locator("#msEditor")).toHaveValue("姉から手紙が届いた――「」。\n// 付箋：ここは後で直す\n");
      await expect(page.locator("#saveState")).toHaveText("保存済み", { timeout: 5000 });
      expect(await readFakeFile(page, EPISODE)).toBe("姉から手紙が届いた――「」。\n// 付箋：ここは後で直す\n");
    });

    test("ルビ：カーソルの前の漢字に読みを訊いて振る。傍点：選んだ字に付ける", async ({ page }) => {
      await openEpisode(page);
      await caret(page, 5);
      await tool(page, "ルビ").click();
      await expect(page.locator(".dialog-message")).toHaveText("「手紙」の読み");
      await page.locator("#dialogInput").fill("てがみ");
      await page.locator('.dialog [data-answer="yes"]').click();
      await expect(page.locator("#msEditor")).toHaveValue("姉から{手紙|てがみ}が届いた。\n// 付箋：ここは後で直す\n");
      await caret(page, 0, 1);
      await tool(page, "傍点").click();
      await expect(page.locator("#msEditor")).toHaveValue("{{姉}}から{手紙|てがみ}が届いた。\n// 付箋：ここは後で直す\n");
      await caret(page, 20);
      await tool(page, "傍点").click();
      await expect(page.locator("#toast")).toHaveText("傍点を付ける字を選んでから押してください");
    });

    test("道具帯は画面からはみ出さず、横へ送れる", async ({ page }) => {
      await openEpisode(page);
      await expect(page.locator("#msTools")).toBeVisible();
      const box = await page.locator("#msTools").boundingBox();
      const viewport = page.viewportSize()!;
      expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height + 1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    });
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
