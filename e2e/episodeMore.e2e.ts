import { expect, test } from "@playwright/test";
import { FAKE_WORKS, listFakeFiles, openWithWorks, readFakeFile } from "./support/fakeWorks";

/** 原稿エディターの上のバーの［…］（設計書 4.4・4.4.2）：この話で AI を走らせる。離れる前に書きかけは保存する。作品は作り物（`_確認用`）だけ */
const PATH = "灯台守_確認用/本文/第1話 手紙.txt";

test("［…］→ 誤字脱字：書きかけを保存してから、この話の見積もりへ", async ({ page }) => {
  await openWithWorks(page, "#/works", FAKE_WORKS);
  await page.locator(".work-card", { hasText: "灯台守の手紙_確認用" }).click();
  await page.locator(".ep-list .ep").first().click();
  const editor = page.locator("textarea#msEditor");
  await editor.click();
  await editor.press("End");
  await page.keyboard.type("足した");
  await page.locator("#episodeMore").click();
  await expect(page.locator(".dialog-choices .dialog-list button")).toHaveText(["新しい話", "章を立てる", "書き出し", "誤字脱字", "推敲", "あらすじ"]);
  await page.locator(".dialog-choices button", { hasText: "誤字脱字" }).click();
  await expect(page).toHaveURL(/#\/typo\//);
  await expect(page.locator(".estimate")).toContainText("第1話 手紙");
  expect(await readFakeFile(page, PATH)).toContain("足した");
});

test("［…］→ あらすじ：この話のあらすじの画面へ", async ({ page }) => {
  await openWithWorks(page, "#/works", FAKE_WORKS);
  await page.locator(".work-card", { hasText: "灯台守の手紙_確認用" }).click();
  await page.locator(".ep-list .ep").first().click();
  await page.locator("#episodeMore").click();
  await page.locator(".dialog-choices button", { hasText: "あらすじ" }).click();
  await expect(page).toHaveURL(/#\/synopsis\//);
});

test("［…］→ 新しい話：次の番号の名前を出し、空の話を作って開く。同じ名前は作らない。在るファイルは上書きしない", async ({ page }) => {
  await openWithWorks(page, "#/works", FAKE_WORKS);
  await page.locator(".work-card", { hasText: "灯台守の手紙_確認用" }).click();
  await page.locator(".ep-list .ep").first().click();
  await page.locator("#episodeMore").click();
  await page.locator(".dialog-choices button", { hasText: "新しい話" }).click();
  const input = page.locator("#dialogInput");
  // 第1〜4話があるので、いちばん新しい話の流儀（第n話）で第5話
  await expect(input).toHaveValue("第5話.txt");
  // 在る名前は断る
  await input.fill("第1話 手紙.txt");
  await page.locator('.dialog [data-answer="yes"]').click();
  await expect(page.locator(".dialog")).toContainText("同じ名前の話がもうあります");
  await input.fill("第5話 灯.txt");
  await page.locator('.dialog [data-answer="yes"]').click();
  await expect(page).toHaveURL(/#\/episode\/.*%E7%AC%AC5%E8%A9%B1/);
  await expect(page.locator("textarea#msEditor")).toHaveValue("");
  expect(await listFakeFiles(page, "灯台守_確認用/本文/")).toContain("灯台守_確認用/本文/第5話 灯.txt");
  expect(await readFakeFile(page, PATH)).toBe("姉から手紙が届いた。\n// 付箋：ここは後で直す\n");
  expect((await listFakeFiles(page, "灯台守_確認用/本文/")).length).toBe(5);
});

test("［…］→ 章を立てる：その話から始まる章を章立てに置き、左の一覧に出る。既にあれば改名", async ({ page }) => {
  await openWithWorks(page, "#/works", FAKE_WORKS);
  await page.locator(".work-card", { hasText: "灯台守の手紙_確認用" }).click();
  // 第2話（章立てに無い話）を開く
  await page.locator(".ep-list .ep").nth(1).click();
  await page.locator("#episodeMore").click();
  await page.locator(".dialog-choices button", { hasText: "章を立てる" }).click();
  await expect(page.locator(".dialog-message")).toHaveText("この話から始まる章の名前");
  await page.locator("#dialogInput").fill("第一章後半　階段");
  await page.locator('.dialog [data-answer="yes"]').click();
  await expect(page.locator("#toast")).toHaveText("「第一章後半　階段」を立てました");
  const saved = JSON.parse((await readFakeFile(page, "灯台守_確認用/設定/章立て.json"))!);
  expect(saved.schemaVersion).toBe("1");
  expect(saved.chapters).toEqual([
    { name: "第一章　灯", startEpisodePath: "本文/第1話 手紙.txt" },
    { name: "第二章　港", startEpisodePath: "本文/第3話 霧笛.txt" },
    { name: "第一章後半　階段", startEpisodePath: "本文/第2話 灯台の階段は百二十段あり、のぼるたびに数え直してしまう.txt" },
  ]);
  // もう一度：今の名前が入っていて、改名になる
  await page.locator("#episodeMore").click();
  await page.locator(".dialog-choices button", { hasText: "章を立てる" }).click();
  await expect(page.locator("#dialogInput")).toHaveValue("第一章後半　階段");
  await page.locator("#dialogInput").fill("間章");
  await page.locator('.dialog [data-answer="yes"]').click();
  await expect(page.locator("#toast")).toHaveText("章の名前を変えました");
  expect(JSON.parse((await readFakeFile(page, "灯台守_確認用/設定/章立て.json"))!).chapters[2].name).toBe("間章");
});

// 2026-11-19 夜 作者の決定「投稿サイト向けの本文を写す」：本体の「コピー（投稿サイト用）」と同じ変換。付箋の行は落とす
test("［…］→ 書き出し → カクヨム：カクヨムの書き方に直した本文が写しに入る", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await openWithWorks(page, "#/works", FAKE_WORKS);
  await page.locator(".work-card", { hasText: "灯台守の手紙_確認用" }).click();
  await page.locator(".ep-list .ep").first().click();
  const editor = page.locator("textarea#msEditor");
  await editor.fill("{灯台|とうだい}の{{手紙}}が届いた。\n// 付箋：ここは後で直す\n");
  await page.locator("#episodeMore").click();
  await page.locator(".dialog-choices button", { hasText: "書き出し" }).click();
  await page.locator(".dialog-choices button", { hasText: /^カクヨム$/ }).click();
  await expect(page.locator("#toast")).toHaveText("カクヨム向けにコピーしました（21字）");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("｜灯台《とうだい》の《《手紙》》が届いた。");
});

// 本体の設計書 6.68.6：写したあと、台帳にそのサイトの投稿ページがあれば［◯◯の投稿ページを開く］を添える。押したときだけ開く
test("［…］→ 書き出し：台帳に登録した投稿先が先に並び、写したあと投稿ページへのリンクが出る", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const url = "https://kakuyomu.jp/my/works/1177354054/episodes/new";
  await openWithWorks(page, "#/works", {
    ...FAKE_WORKS,
    "灯台守_確認用/設定/投稿状態.json": JSON.stringify({ schemaVersion: "1", sites: [{ site: "kakuyomu", newEpisodeUrl: url }], posts: [] }),
  });
  await page.locator(".work-card", { hasText: "灯台守の手紙_確認用" }).click();
  await page.locator(".ep-list .ep").first().click();
  await page.locator("textarea#msEditor").fill("{灯台|とうだい}の{{手紙}}が届いた。\n");
  await page.locator("#episodeMore").click();
  await page.locator(".dialog-choices button", { hasText: "書き出し" }).click();
  await expect(page.locator(".dialog-choices .dialog-list button").first()).toHaveText("カクヨム");
  await page.locator(".dialog-choices button", { hasText: /^カクヨム$/ }).click();
  const dialog = page.locator(".dialog[role=alertdialog]");
  await expect(dialog.locator(".dialog-message")).toHaveText("カクヨム向けにコピーしました（21字）");
  await expect(dialog.locator("a.dialog-link")).toHaveText("カクヨムの投稿ページを開く");
  await expect(dialog.locator("a.dialog-link")).toHaveAttribute("href", url);
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("｜灯台《とうだい》の《《手紙》》が届いた。");
  // 勝手には開かない。［閉じる］で閉じ、原稿の画面のまま
  await dialog.locator("button", { hasText: "閉じる" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator("textarea#msEditor")).toBeVisible();
});

test("［…］→ 書き出し：台帳の URL がそのサイトのものでなければ、リンクは出さない（知らせだけ）", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await openWithWorks(page, "#/works", {
    ...FAKE_WORKS,
    "灯台守_確認用/設定/投稿状態.json": JSON.stringify({ schemaVersion: "1", sites: [{ site: "kakuyomu", newEpisodeUrl: "https://example.com/new" }], posts: [] }),
  });
  await page.locator(".work-card", { hasText: "灯台守の手紙_確認用" }).click();
  await page.locator(".ep-list .ep").first().click();
  await page.locator("textarea#msEditor").fill("{灯台|とうだい}の{{手紙}}が届いた。\n");
  await page.locator("#episodeMore").click();
  await page.locator(".dialog-choices button", { hasText: "書き出し" }).click();
  await page.locator(".dialog-choices button", { hasText: /^カクヨム$/ }).click();
  await expect(page.locator("#toast")).toHaveText("カクヨム向けにコピーしました（21字）");
  await expect(page.locator("a.dialog-link")).toHaveCount(0);
});
