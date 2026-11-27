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
  await expect(page.locator(".dialog-choices .dialog-list button")).toHaveText(["新しい話", "章を立てる", "書き出し", "投稿しました", "読み上げ", "誤字脱字", "推敲", "あらすじ"]);
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

// 2026-11-28 作者の答え「付ける（ぶつかったら両方の印を残す）」：投稿の台帳へ「投稿しました」の印。まだ出した印の無いサイトだけ選べる
test("［…］→ 投稿しました：書きかけを保存してから、選んだサイトの印を台帳に足す。ほかの欄・前の印はそのまま", async ({ page }) => {
  const LEDGER = "灯台守_確認用/設定/投稿状態.json";
  const before = {
    schemaVersion: "1",
    sites: [
      { site: "kakuyomu", newEpisodeUrl: "https://kakuyomu.jp/my/works/1177354054/episodes/new" },
      { site: "narou", newEpisodeUrl: "https://syosetu.com/usernovelmanage/ziwaiinput/ncode/123/" },
    ],
    posts: [{ episodePath: "本文/第1話 手紙.txt", site: "narou", postedAt: "2026-11-01T00:00:00.000Z" }],
    rankings: [],
    futureField: "そのまま",
  };
  await openWithWorks(page, "#/works", { ...FAKE_WORKS, [LEDGER]: `${JSON.stringify(before, null, 2)}\n` });
  await page.locator(".work-card", { hasText: "灯台守の手紙_確認用" }).click();
  await page.locator(".ep-list .ep").first().click();
  const editor = page.locator("textarea#msEditor");
  await editor.click();
  await editor.press("End");
  await page.keyboard.type("足した");
  await page.locator("#episodeMore").click();
  await page.locator(".dialog-choices button", { hasText: "投稿しました" }).click();
  // なろうにはもう出した印があるので、選べるのはカクヨムだけ
  await expect(page.locator(".dialog-choices .dialog-list button")).toHaveText(["カクヨムに投稿した"]);
  await page.locator(".dialog-choices button", { hasText: "カクヨムに投稿した" }).click();
  const sure = page.locator(".dialog[role=alertdialog]");
  await expect(sure.locator(".dialog-message")).toContainText("カクヨムへ投稿した印を付けます");
  await expect(sure.locator(".dialog-message")).toContainText("出した印があるのは 小説家になろう");
  await sure.locator('[data-answer="yes"]').click();
  await expect(page.locator("#toast")).toHaveText("投稿しましたの印を付けました");
  expect(await readFakeFile(page, PATH)).toContain("足した");
  const after = JSON.parse((await readFakeFile(page, LEDGER))!) as Record<string, unknown> & { posts: Array<Record<string, unknown>> };
  expect({ ...after, posts: undefined }).toEqual({ ...before, posts: undefined });
  expect(after.posts).toHaveLength(2);
  expect(after.posts[0]).toEqual(before.posts[0]);
  expect(after.posts[1]).toMatchObject({ episodePath: "本文/第1話 手紙.txt", site: "kakuyomu" });
  expect(String(after.posts[1]!.bodyHash)).toMatch(/^v3:[0-9a-f]{64}$/);
  // 2度目は、もう選べるサイトが無い
  await page.locator("#episodeMore").click();
  await page.locator(".dialog-choices button", { hasText: "投稿しました" }).click();
  await expect(page.locator("#toast")).toHaveText("登録したサイトには、どれも出した印があります");
});

test("［…］→ 投稿しました：投稿先を登録していない作品では、台帳を作らずに知らせる", async ({ page }) => {
  await openWithWorks(page, "#/works", FAKE_WORKS);
  await page.locator(".work-card", { hasText: "灯台守の手紙_確認用" }).click();
  await page.locator(".ep-list .ep").first().click();
  await page.locator("#episodeMore").click();
  await page.locator(".dialog-choices button", { hasText: "投稿しました" }).click();
  await expect(page.locator("#toast")).toHaveText("この作品には投稿先が登録されていません（パソコンの投稿キットで登録します）");
  expect(await readFakeFile(page, "灯台守_確認用/設定/投稿状態.json")).toBeUndefined();
});

// 本体の設計書 6.42（音読推敲）：カーソルのある文から端末の声で読む。本文・選択には触らない。声は偽物（`speechSynthesis` を差し替える）
test("［…］→ 読み上げ：カーソルの文から1文ずつ読み、［止める］で止まる。本文は変わらない", async ({ page }) => {
  await page.addInitScript(() => {
    const spoken: string[] = [];
    let current: { onend: (() => void) | null } | undefined;
    const fake = {
      getVoices: () => [{ lang: "ja-JP", name: "偽の声" }],
      addEventListener: () => undefined,
      speak(utterance: { text: string; onend: (() => void) | null }) {
        spoken.push(utterance.text);
        current = utterance;
      },
      cancel() {
        current = undefined;
      },
    };
    Object.defineProperty(window, "speechSynthesis", { value: fake, configurable: true });
    (window as unknown as { SpeechSynthesisUtterance: unknown }).SpeechSynthesisUtterance = class {
      text: string;
      lang = "";
      rate = 1;
      voice: unknown;
      onend: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(text: string) {
        this.text = text;
      }
    };
    (window as unknown as { __aloud: unknown }).__aloud = { spoken, finish: () => current?.onend?.() };
  });
  await openWithWorks(page, "#/works", FAKE_WORKS);
  await page.locator(".work-card", { hasText: "灯台守の手紙_確認用" }).click();
  await page.locator(".ep-list .ep").first().click();
  const editor = page.locator("textarea#msEditor");
  const body = "一つ目の文。二つ目の文。三つ目の文。";
  await editor.fill(body);
  // カーソルを二つ目の文の頭へ
  await editor.evaluate((el: HTMLTextAreaElement, at) => el.setSelectionRange(at, at), body.indexOf("二つ目"));
  await page.locator("#episodeMore").click();
  await page.locator(".dialog-choices button", { hasText: "読み上げ" }).click();
  await expect(page.locator("#aloudBar")).toBeVisible();
  // 帯は画面の中に出る（枠の下に足すと画面の外へ押し出された。2026-11-27 エミュレーター）
  await expect(page.locator("#aloudBar")).toBeInViewport({ ratio: 1 });
  await expect(page.locator("#aloudNow")).toHaveText("二つ目の文。");
  await page.evaluate(() => (window as unknown as { __aloud: { finish: () => void } }).__aloud.finish());
  await expect(page.locator("#aloudNow")).toHaveText("三つ目の文。");
  await page.locator("#aloudStop").click();
  await expect(page.locator("#aloudBar")).toBeHidden();
  expect(await page.evaluate(() => (window as unknown as { __aloud: { spoken: string[] } }).__aloud.spoken)).toEqual(["二つ目の文。", "三つ目の文。"]);
  await expect(editor).toHaveValue(body);
  expect(await editor.evaluate((el: HTMLTextAreaElement) => [el.selectionStart, el.selectionEnd])).toEqual([body.indexOf("二つ目"), body.indexOf("二つ目")]);
});

test("［…］→ 読み上げ：日本語の声が無ければ読まずに訳を出す", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "speechSynthesis", {
      value: { getVoices: () => [{ lang: "en-US", name: "英語の声" }], addEventListener: () => undefined, speak: () => undefined, cancel: () => undefined },
      configurable: true,
    });
  });
  await openWithWorks(page, "#/works", FAKE_WORKS);
  await page.locator(".work-card", { hasText: "灯台守の手紙_確認用" }).click();
  await page.locator(".ep-list .ep").first().click();
  await page.locator("#episodeMore").click();
  await page.locator(".dialog-choices button", { hasText: "読み上げ" }).click();
  await expect(page.locator("#toast")).toContainText("日本語の読み上げの声が見つかりません", { timeout: 5000 });
  await expect(page.locator("#aloudBar")).toBeHidden();
});
