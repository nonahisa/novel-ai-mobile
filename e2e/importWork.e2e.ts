import { expect, test, type Page } from "@playwright/test";
import { openWithWorks } from "./support/fakeWorks";

/**
 * **GitHub から取り寄せる**（`src/app/importScreen.ts`・`src/platform/workImport.ts`。引継ぎ書 65章）。
 * GitHub は偽物（`page.route`）。作品は作り物（`_確認用`）だけ。合言葉も作り物
 */

const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "*" };
const TOKEN = "gho_tukurimono_import";

async function signIn(page: Page): Promise<string[]> {
  await page.addInitScript(() => ((globalThis as { __novelaiTestGithubClientId?: string }).__novelaiTestGithubClientId = "Ov-e2e"));
  await page.route("https://github.com/login/device/code", (route) =>
    route.fulfill({
      headers: CORS,
      contentType: "application/json",
      body: JSON.stringify({ device_code: "d".repeat(40), user_code: "WDJB-MJHT", verification_uri: "https://github.com/login/device", expires_in: 900, interval: 1 }),
    })
  );
  await page.route("https://github.com/login/oauth/access_token", (route) =>
    route.fulfill({ headers: CORS, contentType: "application/json", body: JSON.stringify({ access_token: TOKEN, scope: "repo" }) })
  );
  await page.route("https://api.github.com/user", (route) =>
    route.fulfill({ headers: CORS, contentType: "application/json", body: JSON.stringify({ login: "sakka-kakuninyou", id: 4321 }) })
  );
  const asked: string[] = [];
  await page.route("https://api.github.com/user/repos**", (route) => {
    asked.push(`${route.request().url()} ${route.request().headers()["authorization"] ?? ""}`);
    return route.fulfill({
      headers: CORS,
      contentType: "application/json",
      body: JSON.stringify([
        { name: "灯台守_確認用", owner: { login: "sakka-kakuninyou" }, private: true, default_branch: "main" },
        { name: "toudai", owner: { login: "sakka-kakuninyou" }, private: true, default_branch: "main" },
      ]),
    });
  });
  return asked;
}

test.describe("GitHub から取り寄せる", () => {
  test("［作品］から開く。サインインしていなければ、サインインの画面へ", async ({ page }) => {
    await openWithWorks(page, "#/works");
    await page.getByRole("button", { name: /GitHub から取り寄せる/ }).click();
    await expect(page).toHaveURL(/#\/import$/);
    await page.locator("#importSlot [data-screen=github]").click();
    await expect(page).toHaveURL(/#\/github$/);
  });

  test("サインインしていれば作者のリポジトリを並べ、端末にある作品は取り寄せ済み。取り寄せに失敗したら1行で知らせ、作りかけを残さない", async ({ page }) => {
    const asked = await signIn(page);
    const gitAsked: string[] = [];
    await page.route("https://github.com/sakka-kakuninyou/**", (route) => {
      gitAsked.push(route.request().url());
      return route.fulfill({ status: 401, headers: CORS, body: "" });
    });
    await openWithWorks(page, "#/github");
    await page.getByRole("button", { name: "サインイン" }).click();
    await expect(page.locator(".gh-state")).toContainText("サインイン済み", { timeout: 10_000 });
    await page.evaluate(() => (location.hash = "#/import"));
    await expect(page.locator(".import-list .ep")).toHaveCount(2);
    await expect(page.locator(".import-list .ep", { hasText: "灯台守_確認用" })).toContainText("取り寄せ済み");
    expect(asked[0]).toContain(`Bearer ${TOKEN}`);
    expect(asked[0].split(" ")[0]).not.toContain(TOKEN);

    await page.locator("[data-import='sakka-kakuninyou/toudai']").click();
    await expect(page.locator("#importResult")).toHaveText("GitHub にサインインし直してください。");
    expect(gitAsked[0]).toContain("/sakka-kakuninyou/toudai.git/info/refs");
    expect(gitAsked.join(" ")).not.toContain(TOKEN);
    // 作りかけのフォルダーを残さない（作品一覧に出ない）
    await page.evaluate(() => (location.hash = "#/works"));
    await expect(page.locator(".work-card").first()).toBeVisible();
    await expect(page.locator(".work-card", { hasText: "toudai" })).toHaveCount(0);
  });
});
