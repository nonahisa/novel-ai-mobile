import { expect, test, type Page } from "@playwright/test";
import { openWithWorks } from "./support/fakeWorks";

/**
 * **画面の自動テスト**（設計書 9章）。見た目が画面の見本（アーティファクト「Android版 画面デザイン」＝
 * `docs/画面デザイン.html`）にそろっているか、押して動くかを見る。
 *
 * 日本語入力は機械では起こせないので、ここでは見ない（実機確認リスト）。
 */

/** 見本の色の印（明るい・暗い）。値は見本と同じ */
const TOKENS = {
  light: {
    "--paper": "#f4f6f9",
    "--surface": "#ffffff",
    "--sunk": "#eceff4",
    "--ink": "#1b2130",
    "--muted": "#5b6475",
    "--line": "#d6dbe4",
    "--accent": "#2c4a8c",
    "--accent-soft": "#e3e9f6",
    "--shu": "#b8432e",
    "--ok": "#2f7a4f",
    "--warn": "#9a6700",
  },
  dark: {
    "--paper": "#101319",
    "--surface": "#181c24",
    "--sunk": "#20252f",
    "--ink": "#e5e8ef",
    "--muted": "#9ba3b3",
    "--line": "#2d3440",
    "--accent": "#93abe8",
    "--accent-soft": "#24304a",
    "--shu": "#f0846d",
    "--ok": "#74c69a",
    "--warn": "#e2b44f",
  },
} as const;

const TAB_IDS = ["works", "write", "proposals", "other"] as const;

/** `#rrggbb` → `rgb(r, g, b)`（getComputedStyle の形） */
function rgb(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}

async function open(page: Page, hash: string): Promise<void> {
  await page.goto(`/${hash}`);
  await expect(page.locator(".appbar")).toBeVisible();
}

/** ページが横にはみ出していないか（スマホで横に送れてしまわないか） */
async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
}

test.describe("色と書体（見本の印）", () => {
  test("色の印が見本の値と同じ（端末の明るい・暗いに合わせる）", async ({ page }, info) => {
    await open(page, "#/works");
    const scheme = info.project.use.colorScheme === "dark" ? "dark" : "light";
    const actual = await page.evaluate((names) => {
      const style = getComputedStyle(document.documentElement);
      // 組み立てで #ffffff が #fff に縮むので、6桁にそろえて比べる
      const long = (v: string) => (/^#[0-9a-f]{3}$/.test(v) ? "#" + [...v.slice(1)].map((c) => c + c).join("") : v);
      return Object.fromEntries(names.map((n) => [n, long(style.getPropertyValue(n).trim().toLowerCase())]));
    }, Object.keys(TOKENS[scheme]));
    expect(actual).toEqual(TOKENS[scheme]);
    // 一覧の画面の地は一段沈んだ色、上のバーと下のタブは画面の地
    await expect(page.locator("body")).toHaveCSS("background-color", rgb(TOKENS[scheme]["--sunk"]));
    await expect(page.locator(".appbar")).toHaveCSS("background-color", rgb(TOKENS[scheme]["--surface"]));
    await expect(page.locator(".tabbar")).toHaveCSS("background-color", rgb(TOKENS[scheme]["--surface"]));
  });

  test("藍の地の押し口は、地の色の字（暗い画面でも読める）", async ({ page }, info) => {
    await open(page, "#/tategaki");
    const scheme = info.project.use.colorScheme === "dark" ? "dark" : "light";
    const save = page.locator("#draftSave");
    await expect(save).toHaveCSS("background-color", rgb(TOKENS[scheme]["--accent"]));
    await expect(save).toHaveCSS("color", rgb(TOKENS[scheme]["--surface"]));
  });

  test("画面の字は端末のゴシック、原稿は明朝（Google Fonts は読まない）", async ({ page }) => {
    await open(page, "#/tategaki");
    const body = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
    expect(body).toMatch(/^"?BIZ UDPGothic"?, "?Hiragino Sans"?/);
    const ms = await page.locator("#draftInput").evaluate((el) => getComputedStyle(el).fontFamily);
    expect(ms).toMatch(/Mincho/);
    const remote = await page.evaluate(() =>
      [...document.querySelectorAll("link[href]")].map((l) => l.getAttribute("href")).filter((h) => /fonts\.googleapis/.test(h ?? ""))
    );
    expect(remote).toEqual([]);
  });
});

test.describe("上のバーと下のタブ（見本の並び）", () => {
  test("上のバーは高さ 52、下のタブは高さ 64 で4つ。いまのタブだけ藍で、絵に淡い藍の地", async ({ page }, info) => {
    await open(page, "#/proposals");
    expect((await page.locator(".appbar").boundingBox())!.height).toBeCloseTo(52, 0);
    const tabs = page.locator(".tabbar .tab");
    await expect(tabs).toHaveCount(4);
    for (const id of TAB_IDS) {
      const tab = page.locator(`.tab[data-tab="${id}"]`);
      expect((await tab.boundingBox())!.height).toBeCloseTo(64, 0);
      await expect(tab.locator("svg")).toHaveCount(1);
    }
    const scheme = info.project.use.colorScheme === "dark" ? "dark" : "light";
    const current = page.locator('.tab[aria-current="page"]');
    await expect(current).toHaveCount(1);
    await expect(current).toHaveAttribute("data-tab", "proposals");
    await expect(current).toHaveCSS("color", rgb(TOKENS[scheme]["--accent"]));
    await expect(current.locator("svg")).toHaveCSS("background-color", rgb(TOKENS[scheme]["--accent-soft"]));
    await expect(page.locator('.tab[data-tab="works"]')).toHaveCSS("color", rgb(TOKENS[scheme]["--muted"]));
  });

  test("タブを押すと画面が替わり、題はタブの名前。版は［ほか］の題の下だけ", async ({ page }, info) => {
    await open(page, "#/works");
    await expect(page.locator(".appbar-title")).toHaveText("作品");
    await expect(page.locator(".appbar-title small")).toHaveCount(0);
    const touch = info.project.use.hasTouch;
    const tab = page.locator('.tab[data-tab="write"]');
    if (touch) await tab.tap();
    else await tab.click();
    await expect(page).toHaveURL(/#\/write$/);
    await expect(page.locator('.tab[aria-current="page"]')).toHaveAttribute("data-tab", "write");
    await open(page, "#/other");
    await expect(page.locator(".appbar-title small")).toContainText("モバイル版");
  });

  test("説明はレイアウトに任せる：設計書の番号・説明の行を画面に出さない（設計書 4.6）", async ({ page }) => {
    for (const hash of ["#/works", "#/write", "#/proposals", "#/other", "#/all"]) {
      await open(page, hash);
      await expect(page.locator(".menu-lead, .menu-section .menu-how")).toHaveCount(0);
      expect(await page.locator("main").innerText()).not.toMatch(/設計書|【案】|（[A-I]）|の\d段目|（\d\.\d/);
    }
  });

  test("すべての機能は大分類の見出しで束ね、行には置き場だけ", async ({ page }) => {
    await open(page, "#/all");
    await expect(page.locator("#actionRows .menu-group").first()).toBeVisible();
    await expect(page.locator("#actionCount")).toHaveText(/^\d+件$/);
    const note = await page.locator("#actionRows .menu-note").first().innerText();
    expect(note).not.toContain("置き場：");
    await expect(page.locator("#actionSearch")).toHaveAttribute("placeholder", "探す");
  });

  test("［戻る］は丸い押し口（44×44）で、押すと開いていたタブへ戻る", async ({ page }) => {
    await open(page, "#/other");
    await page.goto("/#/all");
    const back = page.locator(".appbar-back");
    await expect(back).toHaveAttribute("aria-label", "戻る");
    const box = (await back.boundingBox())!;
    expect(box.width).toBeCloseTo(44, 0);
    expect(box.height).toBeCloseTo(44, 0);
    await back.click();
    await expect(page).toHaveURL(/#\/other$/);
  });

  test("原稿の画面では下のタブを隠す（設計書 4.3）", async ({ page }) => {
    await open(page, "#/tategaki");
    await expect(page.locator(".tabbar")).toBeHidden();
    await expect(page.locator(".appbar-title")).toContainText("縦書き・横書きの試し");
    // 字数は上のバーの題の下に出す（見本の原稿エディターと同じ所）
    await expect(page.locator("#draftCount")).toContainText("字");
  });
});

test.describe("一覧の画面", () => {
  for (const hash of ["#/works", "#/write", "#/proposals", "#/other", "#/all", "#/tategaki", "#/check"]) {
    test(`${hash} が横にはみ出さない`, async ({ page }) => {
      await open(page, hash);
      expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    });
  }

  test("項目は見本の札（角 14・罫）。灰色の項目を押すと「まだ作っていません」と出る", async ({ page }) => {
    await open(page, "#/works");
    const item = page.locator(".menu-item.planned").first();
    await expect(item).toHaveCSS("border-top-left-radius", "14px");
    // aria-disabled の項目も押せる形（押すと知らせる）。Playwright は押せないものと見るので force で押す
    await item.click({ force: true });
    await expect(page.locator("#toast")).toHaveClass(/shown/);
    await expect(page.locator("#toast")).toContainText("まだ作っていません");
  });

  test("作ってある項目は画面を開く", async ({ page }) => {
    await open(page, "#/write");
    await page.locator('.menu-item.built[data-screen="tategaki"]').click();
    await expect(page).toHaveURL(/#\/tategaki$/);
  });

  test("すべての機能を2文字で絞れる", async ({ page }) => {
    await open(page, "#/all");
    const rows = page.locator("#actionRows .menu-item");
    const before = await rows.count();
    await page.locator("#actionSearch").fill("誤字");
    await expect.poll(() => rows.count()).toBeLessThan(before);
    await expect(page.locator("#actionRows")).toContainText("誤字脱字検知");
  });
});

test.describe("打つ欄（iOS が画面を拡大しないか・原稿の欄を動かしていないか）", () => {
  test("字を打つ欄の字は 16px 以上", async ({ page }) => {
    for (const hash of ["#/all", "#/tategaki"]) {
      await open(page, hash);
      const small = await page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>("input:not([type=checkbox]), textarea, [contenteditable]")]
          .filter((el) => el.offsetParent !== null)
          .map((el) => ({ id: el.id || el.className, size: parseFloat(getComputedStyle(el).fontSize) }))
          .filter((x) => x.size < 16)
      );
      expect(small, hash).toEqual([]);
    }
  });

  test("縦書きの欄は 0.1.19 と同じ形（縦書き・明朝 18px・高さは画面の 52%）", async ({ page }) => {
    await open(page, "#/tategaki");
    const input = page.locator("#draftInput");
    await expect(input).toHaveCSS("writing-mode", "vertical-rl");
    await expect(input).toHaveCSS("font-size", "18px");
    const { height, vh } = await input.evaluate((el) => ({ height: el.getBoundingClientRect().height, vh: window.innerHeight }));
    expect(height).toBeCloseTo(Math.max(260, vh * 0.52), 0);
  });

  test("向きと形の切り替えは丸い押し口で、選んだものは藍の地", async ({ page }, info) => {
    await open(page, "#/tategaki");
    const scheme = info.project.use.colorScheme === "dark" ? "dark" : "light";
    const horizontal = page.locator('[data-orient="horizontal"]');
    await horizontal.click();
    await expect(horizontal).toHaveAttribute("aria-pressed", "true");
    await expect(horizontal).toHaveCSS("background-color", rgb(TOKENS[scheme]["--accent"]));
    await expect(page.locator("#draftInput")).toHaveCSS("writing-mode", "horizontal-tb");
    await page.locator('[data-orient="vertical"]').click();
  });

  test("B の受け口の段は、B を選んだときだけ出る（A では隠す）", async ({ page }) => {
    await open(page, "#/tategaki");
    const sinkSeg = page.locator("#sinkSeg");
    await expect(page.locator('[data-mode="A"]')).toHaveAttribute("aria-pressed", "true");
    await expect(sinkSeg).toBeHidden();
    await page.locator('[data-mode="B"]').click();
    await expect(sinkSeg).toBeVisible();
    await page.locator('[data-mode="A"]').click();
    await expect(sinkSeg).toBeHidden();
  });
});

test.describe("作品一覧（A）と話の一覧（B）", () => {
  test("作品が1つも無いときは空の形だけ（説明の文を並べない）", async ({ page }) => {
    await open(page, "#/works");
    await expect(page.locator(".work-list .work-empty")).toBeVisible();
    await expect(page.locator("#workListSlot")).toHaveText("");
    await expect(page.locator(".work-card")).toHaveCount(0);
  });

  test("端末の中の作品を題・話数・字数で並べ、壊れた設定の作品だけ知らせる。横にはみ出さない", async ({ page }) => {
    await openWithWorks(page, "#/works");
    const cards = page.locator(".work-card");
    await expect(cards).toHaveCount(3);
    // 試し/ は作品にしない
    expect((await cards.locator(".work-title").allInnerTexts()).sort()).toEqual(
      ["壊れた設定_確認用", "灯台守の手紙_確認用", "雨の駅でいつまでも待ち続けている人と、その人を見送る駅員の長い長い物語_確認用"].sort()
    );
    // 4話（競合の印のある第4話は字数に入れない）。付箋（// の行）は数えない
    const lighthouse = cards.filter({ hasText: "灯台守の手紙_確認用" });
    await expect(lighthouse.locator(".work-meta span")).toHaveText(["4話", "22字"]);
    await expect(lighthouse.locator(".flag.shu")).toHaveText("競合：1話");
    const broken = cards.filter({ hasText: "壊れた設定_確認用" });
    await expect(broken.locator(".work-meta")).toHaveCount(0);
    await expect(broken.locator(".flag.shu")).toContainText("作品設定を読み込めません");
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  });

  test("作品を押すと章ごとの話の一覧。競合の話は開かない。話を押すと原稿エディター、［←］で作品一覧へ", async ({ page }, info) => {
    await openWithWorks(page, "#/works");
    const card = page.locator(".work-card", { hasText: "灯台守の手紙_確認用" });
    if (info.project.use.hasTouch) await card.tap();
    else await card.click();
    await expect(page).toHaveURL(/#\/work\//);
    await expect(page.locator(".appbar-title")).toContainText("灯台守の手紙_確認用");
    await expect(page.locator("#workSummary")).toHaveText("4話・22字");
    // 下のタブは出したまま、［作品］が選ばれている
    await expect(page.locator('.tab[aria-current="page"]')).toHaveAttribute("data-tab", "works");
    await expect(page.locator(".ep-list .chap")).toHaveText(["第一章　灯", "第二章　港"]);
    const rows = page.locator(".ep-list .ep");
    await expect(rows.locator(".no")).toHaveText(["第1話", "第2話", "第3話", "第4話"]);
    await expect(rows.nth(0).locator(".chars")).toHaveText("10字");
    await expect(rows.nth(3).locator(".flag.shu")).toHaveText("競合");
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    // 長い題の話も1行に収める（行の外へはみ出さない。狭い幅では省く）
    expect(await rows.nth(1).evaluate((el) => el.scrollWidth <= el.clientWidth && el.getBoundingClientRect().height < 60)).toBe(true);

    // 競合の話は aria-disabled なので、Playwright は押せないものと見る。force で押す
    await rows.nth(3).click({ force: true });
    await expect(page.locator("#toast")).toHaveClass(/shown/);
    await expect(page.locator("#toast")).toHaveText("競合が残っているので開けません");
    await expect(page).toHaveURL(/#\/work\//);

    await rows.nth(0).click();
    await expect(page).toHaveURL(/#\/episode\//);
    await expect(page.locator("#msEditor")).toBeVisible();
    await page.locator(".appbar-back").click();
    await expect(page).toHaveURL(/#\/work\//);

    await page.locator(".appbar-back").click();
    await expect(page).toHaveURL(/#\/works$/);
    await expect(page.locator(".work-card")).toHaveCount(3);
  });

  test("話の一覧も設計書の番号・説明の行を出さない", async ({ page }) => {
    await openWithWorks(page, "#/works");
    await page.locator(".work-card", { hasText: "灯台守の手紙_確認用" }).click();
    await expect(page.locator(".ep-list .ep")).toHaveCount(4);
    expect(await page.locator("main").innerText()).not.toMatch(/設計書|【案】|（[A-I]）/);
  });

  test("壊れた設定の作品を開くと、話の代わりに理由だけを出す（はみ出さない）", async ({ page }) => {
    await openWithWorks(page, "#/works");
    await page.locator(".work-card", { hasText: "壊れた設定_確認用" }).click();
    await expect(page.locator("#episodeSlot .flag.shu")).toContainText("作品設定を読み込めません");
    await expect(page.locator(".ep-list")).toHaveCount(0);
    await expect(page.locator(".appbar-title")).toContainText("壊れた設定_確認用");
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  });
});
