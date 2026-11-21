import { expect, test, type Page } from "@playwright/test";
import { FAKE_WORKS, openWithWorks, readFakeFile } from "./support/fakeWorks";

/**
 * **作品の長押し**（設計書 4.4.1。2026-11-18 作者の答え）：題を変える（設定ファイルの workTitle。フォルダー名は変えない）・
 * 登録から外す（送っていないもの・GitHub と結んでいない作品は外さない）。作品は作り物（`_確認用`）だけ
 */
async function longPressWork(page: Page, title: string) {
  const box = (await page.locator(".work-card", { hasText: title }).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(700);
  await page.mouse.up();
}

test("作品を長押し → 題を変える：一覧の題と設定ファイルの workTitle が替わる。フォルダーと話はそのまま", async ({ page }) => {
  await openWithWorks(page, "#/works", FAKE_WORKS);
  await longPressWork(page, "灯台守の手紙_確認用");
  await page.locator(".dialog-choices button", { hasText: "題を変える" }).click();
  await expect(page.locator("#dialogInput")).toHaveValue("灯台守の手紙_確認用");
  await page.locator("#dialogInput").fill("霧笛の灯台_確認用");
  await page.locator('[data-answer="yes"]').click();
  await expect(page.locator(".work-card", { hasText: "霧笛の灯台_確認用" })).toBeVisible();
  const config = JSON.parse((await readFakeFile(page, "灯台守_確認用/.aiwriter/config.json"))!);
  expect(config.workTitle).toBe("霧笛の灯台_確認用");
  expect(await readFakeFile(page, "灯台守_確認用/本文/第1話 手紙.txt")).toBe(FAKE_WORKS["灯台守_確認用/本文/第1話 手紙.txt"]);
});

test("作品を長押し → 登録から外す：GitHub と結んでいない作品は外さず、訳を出す（フォルダーは残る）", async ({ page }) => {
  await openWithWorks(page, "#/works", FAKE_WORKS);
  await longPressWork(page, "灯台守の手紙_確認用");
  await page.locator(".dialog-choices button", { hasText: "登録から外す" }).click();
  await expect(page.locator(".dialog-message")).toContainText("GitHub と結んでいない");
  await page.locator(".dialog [data-answer]").first().click();
  await expect(page.locator(".work-card", { hasText: "灯台守の手紙_確認用" })).toBeVisible();
  expect(await readFakeFile(page, "灯台守_確認用/本文/第1話 手紙.txt")).toBeDefined();
});

test("長押しする一覧の行と、長押しで出す窓の字は、端末の字の選びを出さない（2026-11-18 Mac：窓の字に iOS のつまみが出た）", async ({ page }) => {
  await openWithWorks(page, "#/works", FAKE_WORKS);
  const card = page.locator(".work-card").first();
  expect(await card.evaluate((el) => getComputedStyle(el).userSelect)).toBe("none");
  await longPressWork(page, "灯台守の手紙_確認用");
  const choice = page.locator(".dialog-choices .dialog-list button").first();
  await expect(choice).toBeVisible();
  expect(await choice.evaluate((el) => getComputedStyle(el).userSelect)).toBe("none");
});

/**
 * **作品を長押し → シリーズ：つなぐ・外す**（2026-11-20 夜 作者の答え「つなぐ・外すまで」。本体の `features/setSeries.ts` と同じ）。
 * 相手は同じ置き場に並ぶほかの作品（フォルダー名で書く）。呼び名は作者が書く（推さない）。相手の設定ファイルは触らない
 */
test("作品を長押し → シリーズ：隣の作品を選んで呼び名を入れるとつながり、全部外すと解ける。相手は書き換えない", async ({ page }) => {
  await openWithWorks(page, "#/works", FAKE_WORKS);
  const other = "雨の駅でいつまでも待ち続けている人と、その人を見送る駅員の長い長い物語_確認用";
  const before = await readFakeFile(page, `${other}/.aiwriter/config.json`);
  await longPressWork(page, "灯台守の手紙_確認用");
  await page.locator(".dialog-choices button", { hasText: "シリーズ" }).click();
  const picks = page.locator(".dialog-many input[type=checkbox]");
  // 自分は出さない。ほかの作品が並ぶ
  await expect(page.locator(".dialog-many label", { hasText: "灯台守の手紙_確認用" })).toHaveCount(0);
  await expect(page.locator(".dialog-many label", { hasText: other })).toHaveCount(1);
  await page.locator(".dialog-many label", { hasText: other }).locator("input").check();
  await page.locator('.dialog-many [data-answer="yes"]').click();
  await expect(page.locator("#dialogInput")).toHaveValue("");
  await page.locator("#dialogInput").fill("灯台と駅_確認用");
  await page.locator('[data-answer="yes"]').click();
  await expect(page.locator(".toast")).toContainText("つなぎました");
  const config = JSON.parse((await readFakeFile(page, "灯台守_確認用/.aiwriter/config.json"))!);
  expect(config).toEqual({ workTitle: "灯台守の手紙_確認用", series: { name: "灯台と駅_確認用", related: [other] } });
  expect(await readFakeFile(page, `${other}/.aiwriter/config.json`)).toBe(before);

  // もう一度開くと、つないだ作品に印・呼び名が入っている。全部外すと解ける
  await longPressWork(page, "灯台守の手紙_確認用");
  await page.locator(".dialog-choices button", { hasText: "シリーズ" }).click();
  await expect(picks.first()).toBeVisible();
  const box = page.locator(".dialog-many label", { hasText: other }).locator("input");
  await expect(box).toBeChecked();
  await box.uncheck();
  await page.locator('.dialog-many [data-answer="yes"]').click();
  await expect(page.locator(".toast")).toContainText("解きました");
  const after = JSON.parse((await readFakeFile(page, "灯台守_確認用/.aiwriter/config.json"))!);
  expect(after).toEqual({ workTitle: "灯台守の手紙_確認用" });
});

/**
 * **作品を長押し → 作品の設定**（2026-11-21 作者の答え「形式・ジャンルも」。本体の［作品管理 → 作品別設定］と同じ流れ）。
 * メモの印・作品の種類は作品の設定ファイルに書く。本文は1字も書き換えない
 */
test("作品の設定 → メモの印：新しくオンにする印で始まる行を数えて見せてから切り替え、字数がその行のぶん減る。本文はそのまま", async ({ page }) => {
  const episode = "灯台守_確認用/本文/第3話 霧笛.txt";
  await openWithWorks(page, "#/works", { ...FAKE_WORKS, [episode]: "霧が出た。\n%% 港の場面はあとで\n" });
  await longPressWork(page, "灯台守の手紙_確認用");
  await page.locator(".dialog-choices button", { hasText: "作品の設定" }).click();
  await page.locator(".dialog-choices button", { hasText: "メモの印" }).click();
  const percent = page.locator(".dialog-check", { hasText: "%% と ％％" }).locator("input");
  await expect(page.locator(".dialog-check", { hasText: "// と ／／" }).locator("input")).toBeChecked();
  await percent.check();
  await page.locator('.dialog-many [data-answer="yes"]').click();
  await expect(page.locator(".dialog-message")).toContainText("%% と ％％ で始まる行が1か所あります（第3話 2行目）");
  await page.locator('[data-answer="yes"]').click();
  await expect(page.locator(".toast").last()).toContainText("メモの印を「// と ／／・%% と ％％」にしました");
  const config = JSON.parse((await readFakeFile(page, "灯台守_確認用/.aiwriter/config.json"))!);
  expect(config).toMatchObject({ workTitle: "灯台守の手紙_確認用", memoMarkers: ["slash", "percent"] });
  expect(await readFakeFile(page, episode)).toBe("霧が出た。\n%% 港の場面はあとで\n");
});

test("作品の設定 → 作品の種類：いまの種類に印、選ぶと設定ファイルの kind が替わる", async ({ page }) => {
  await openWithWorks(page, "#/works", FAKE_WORKS);
  await longPressWork(page, "灯台守の手紙_確認用");
  await page.locator(".dialog-choices button", { hasText: "作品の設定" }).click();
  await page.locator(".dialog-choices button", { hasText: "作品の種類" }).click();
  await expect(page.locator(".dialog-choices button", { hasText: "（いまの種類）" })).toContainText("小説");
  await page.locator(".dialog-choices button", { hasText: "台本（脚本・シナリオ）" }).click();
  await expect(page.locator(".toast").last()).toContainText("種類を「台本（脚本・シナリオ）」にしました");
  const config = JSON.parse((await readFakeFile(page, "灯台守_確認用/.aiwriter/config.json"))!);
  expect(config).toMatchObject({ workTitle: "灯台守の手紙_確認用", kind: "script" });
});

test("作品の設定 → 形式・ジャンル：形式を選び、投稿先ごとにジャンルを選んでプロットへ書く。作者が書いたほかの節はそのまま", async ({ page }) => {
  const plot = "灯台守_確認用/設定/plot.md";
  await openWithWorks(page, "#/works", { ...FAKE_WORKS, [plot]: "# 灯台守の手紙_確認用\n\n## ログライン\n\n姉の手紙を追う。\n" });
  await longPressWork(page, "灯台守の手紙_確認用");
  await page.locator(".dialog-choices button", { hasText: "作品の設定" }).click();
  await page.locator(".dialog-choices button", { hasText: "形式・ジャンル" }).click();
  await page.locator(".dialog-choices button", { hasText: /^長編/ }).click();
  await page.locator(".dialog-choices button", { hasText: "カクヨム" }).click();
  await page.locator(".dialog-check", { hasText: "現代ドラマ" }).locator("input").check();
  await page.locator('.dialog-many [data-answer="yes"]').click();
  await expect(page.locator(".dialog-choices button", { hasText: "これで決める" })).toContainText("現代ドラマ");
  await page.locator(".dialog-choices button", { hasText: "小説家になろう" }).click();
  await page.locator(".dialog-check", { hasText: "文芸 > ヒューマンドラマ" }).locator("input").check();
  await page.locator('.dialog-many [data-answer="yes"]').click();
  await page.locator(".dialog-choices button", { hasText: "これで決める" }).click();
  await expect(page.locator(".toast").last()).toContainText("形式を「長編」、ジャンルを2件、プロットへ書きました");
  const after = (await readFakeFile(page, plot))!;
  expect(after).toContain("## ログライン\n\n姉の手紙を追う。");
  expect(after).toMatch(/## 形式\s+長編/);
  expect(after).toContain("- 現代ドラマ（カクヨム）");
  expect(after).toContain("- 文芸 > ヒューマンドラマ（小説家になろう）");
});

test("作品の設定 → 形式・ジャンル：ジャンルの所で［すべてやめる］を押すと、何も書かない", async ({ page }) => {
  await openWithWorks(page, "#/works", FAKE_WORKS);
  await longPressWork(page, "灯台守の手紙_確認用");
  await page.locator(".dialog-choices button", { hasText: "作品の設定" }).click();
  await page.locator(".dialog-choices button", { hasText: "形式・ジャンル" }).click();
  await page.locator(".dialog-choices button", { hasText: /^短編/ }).first().click();
  await page.locator('.dialog-choices [data-answer="no"]', { hasText: "すべてやめる" }).click();
  expect(await readFakeFile(page, "灯台守_確認用/設定/plot.md")).toBeUndefined();
});
