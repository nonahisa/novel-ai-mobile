import { createHash } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { openWithWorks } from "./support/fakeWorks";

/**
 * **更新の仕組み：新しい版の確かめと知らせ**（2026-11-20 作者「全製品共通ですが、アップデートの仕組みを作ってください」。
 * 共通の決まりは統合の `docs/更新の仕組み_共通.md`。引継ぎ書 154章）。GitHub は偽物（`page.route`）
 */

const LATEST = "https://api.github.com/repos/nonahisa/novel-ai-mobile/releases/latest";
const PREFIX = "https://github.com/nonahisa/novel-ai-mobile/releases/download/";
const CORS = { "access-control-allow-origin": "*" };

async function fakeRelease(page: Page, version: string): Promise<{ asked: string[] }> {
  const ticket = JSON.stringify({
    product: "novel-ai-mobile",
    version,
    date: "2026-11-21",
    summary: ["話の一覧をたためるようにしました", "カーソルのちらつきを直しました"],
    assets: [{ platform: "android", name: `novel-ai-mobile-${version}.apk`, url: `${PREFIX}v${version}/novel-ai-mobile-${version}.apk`, sha256: "c".repeat(64), bytes: 1000 }],
    minimumFrom: null,
  });
  const sha = createHash("sha256").update(ticket).digest("hex");
  const asked: string[] = [];
  await page.route(LATEST, (route) => {
    asked.push(`${route.request().url()} auth=${route.request().headers()["authorization"] ?? "none"}`);
    return route.fulfill({
      headers: CORS,
      contentType: "application/json",
      body: JSON.stringify({ tag_name: `v${version}`, body: `中身\n\nSHA-256：${sha}`, assets: [{ name: "update.json", browser_download_url: `${PREFIX}v${version}/update.json` }] }),
    });
  });
  await page.route(`${PREFIX}**`, (route) => {
    asked.push(route.request().url());
    return route.fulfill({ headers: CORS, contentType: "application/octet-stream", body: ticket });
  });
  return { asked };
}

test.describe("更新", () => {
  test("［ほか］→［更新］：今の版と、自動で確かめるかの切り替え。試しのブラウザでは、選ぶまで起動しても見に行かない（端末の既定はオン）", async ({ page }) => {
    const { asked } = await fakeRelease(page, "9.9.9");
    await openWithWorks(page, "#/other");
    await page.locator('[data-screen="update"]').click();
    await expect(page).toHaveURL(/#\/update$/);
    await expect(page.locator(".update-current")).toContainText("モバイル版 0.1.");
    await expect(page.locator('[data-update-auto="off"]')).toHaveAttribute("aria-pressed", "true");
    expect(asked).toEqual([]);
  });

  test("［今すぐ確かめる］：新しい版の知らせ（版・中身の要約・［あとで］［この版は飛ばす］）。合言葉は送らない", async ({ page }) => {
    const { asked } = await fakeRelease(page, "9.9.9");
    await openWithWorks(page, "#/update");
    await page.locator('[data-update="check"]').click();
    const notice = page.locator(".update-notice");
    await expect(notice).toBeVisible();
    await expect(notice.locator(".dialog-message")).toHaveText("新しい版 9.9.9 があります");
    await expect(notice.locator(".update-summary li")).toHaveText(["話の一覧をたためるようにしました", "カーソルのちらつきを直しました"]);
    // パソコンのブラウザ（試し）は Android ではないので［入れる］は出ない
    await expect(notice.locator('[data-answer="install"]')).toHaveCount(0);
    await notice.locator('[data-answer="skip"]').click();
    await expect(notice).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem("novelai.update.skipped"))).toBe("9.9.9");
    expect(asked).toEqual([`${LATEST} auth=none`, `${PREFIX}v9.9.9/update.json`]);
  });

  test("いまの版が最新なら、そう言う", async ({ page }) => {
    await fakeRelease(page, "0.0.1");
    await openWithWorks(page, "#/update");
    await page.locator('[data-update="check"]').click();
    await expect(page.locator(".update-result")).toContainText("いまの版が最新です");
    await expect(page.locator(".update-notice")).toHaveCount(0);
  });

  test("自動で確かめるをオンにすると、起動したときに1日1回まで見に行き、知らせる。飛ばした版は知らせない", async ({ page }) => {
    const { asked } = await fakeRelease(page, "9.9.9");
    await page.addInitScript(() => {
      if (!sessionStorage.getItem("seeded")) {
        localStorage.setItem("novelai.update.auto", "on");
        sessionStorage.setItem("seeded", "1");
      }
    });
    await page.goto("/#/works");
    await expect(page.locator(".update-notice")).toBeVisible();
    await page.locator('.update-notice [data-answer="later"]').click();
    expect(asked.length).toBe(2);
    // 開き直しても、1日たっていなければ見に行かない
    await page.reload();
    await expect(page.locator("#tabbar")).toBeVisible();
    await page.waitForTimeout(300);
    expect(asked.length).toBe(2);
    // 1日たったことにする → 見に行くが、飛ばした版なら知らせない
    await page.evaluate(() => {
      localStorage.setItem("novelai.update.lastCheck", String(Date.now() - 25 * 60 * 60 * 1000));
      localStorage.setItem("novelai.update.skipped", "9.9.9");
    });
    await page.reload();
    await expect.poll(() => asked.length).toBe(4);
    await page.waitForTimeout(300);
    await expect(page.locator(".update-notice")).toHaveCount(0);
  });

  test("札と Release ノートの SHA-256 が合わなければ、知らせない（黙る）", async ({ page }) => {
    await page.route(LATEST, (route) =>
      route.fulfill({
        headers: CORS,
        contentType: "application/json",
        body: JSON.stringify({ body: `SHA-256：${"d".repeat(64)}`, assets: [{ name: "update.json", browser_download_url: `${PREFIX}v9.9.9/update.json` }] }),
      })
    );
    await page.route(`${PREFIX}**`, (route) => route.fulfill({ headers: CORS, body: '{"product":"novel-ai-mobile","version":"9.9.9"}' }));
    await openWithWorks(page, "#/update");
    await page.locator('[data-update="check"]').click();
    await expect(page.locator(".update-result")).toContainText("確かめられませんでした");
    await expect(page.locator(".update-notice")).toHaveCount(0);
  });
});
