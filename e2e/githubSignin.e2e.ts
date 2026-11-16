import { expect, test, type Page } from "@playwright/test";
import { openWithWorks } from "./support/fakeWorks";

/**
 * **GitHub と同期（サインイン）**（`src/app/githubScreen.ts`。引継ぎ書 58章）。
 * GitHub は偽物（`page.route`）。Client ID・合言葉は作り物で、ブラウザのときだけ差し込める口から入れる
 */

const FAKE_TOKEN = "gho_tukurimono_e2e_0000";
const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "*" };

async function fakeGitHub(page: Page, tokenAnswers: object[]) {
  const seen: string[] = [];
  await page.route("https://github.com/login/device/code", (route) => {
    seen.push("code");
    return route.fulfill({
      headers: CORS,
      contentType: "application/json",
      body: JSON.stringify({ device_code: "d".repeat(40), user_code: "WDJB-MJHT", verification_uri: "https://github.com/login/device", expires_in: 900, interval: 1 }),
    });
  });
  await page.route("https://github.com/login/oauth/access_token", (route) => {
    seen.push("token");
    const answer = tokenAnswers.shift() ?? { error: "authorization_pending" };
    return route.fulfill({ headers: CORS, contentType: "application/json", body: JSON.stringify(answer) });
  });
  await page.route("https://api.github.com/user", (route) =>
    route.fulfill({ headers: CORS, contentType: "application/json", body: JSON.stringify({ login: "sakka-kakuninyou", id: 4321 }) })
  );
  return seen;
}

test.describe("GitHub と同期", () => {
  test("Client ID が無いあいだは［サインイン］は灰色の未", async ({ page }) => {
    await openWithWorks(page, "#/other");
    await page.getByRole("button", { name: /GitHub と同期/ }).click();
    await expect(page).toHaveURL(/#\/github$/);
    await expect(page.locator(".gh-panel .planned")).toContainText("サインイン");
  });

  test("サインイン → コード → 許されたらサインイン済み。合言葉は画面に出ない。サインアウトで消える", async ({ page }) => {
    await page.addInitScript(() => ((globalThis as { __novelaiTestGithubClientId?: string }).__novelaiTestGithubClientId = "Ov-e2e"));
    const seen = await fakeGitHub(page, [{ error: "authorization_pending" }, { access_token: FAKE_TOKEN, token_type: "bearer", scope: "repo" }]);
    await openWithWorks(page, "#/github");
    await page.getByRole("button", { name: "サインイン" }).click();
    await expect(page.locator(".gh-code")).toHaveText("WDJB-MJHT");
    await expect(page.locator("a.gh-open")).toHaveAttribute("href", "https://github.com/login/device");
    await expect(page.locator(".gh-state")).toContainText("サインイン済み", { timeout: 10_000 });
    await expect(page.locator(".gh-state")).toContainText("sakka-kakuninyou");
    expect(seen.filter((s) => s === "token").length).toBe(2);
    expect(await page.content()).not.toContain(FAKE_TOKEN);
    expect(page.url()).not.toContain(FAKE_TOKEN);
    // 離れて戻っても、サインイン済み
    await page.evaluate(() => (location.hash = "#/other"));
    await expect(page).toHaveURL(/#\/other$/);
    await page.evaluate(() => (location.hash = "#/github"));
    await expect(page.locator(".gh-state")).toContainText("サインイン済み");
    await page.getByRole("button", { name: "サインアウト" }).click();
    await page.locator('[data-answer="yes"]').click();
    await expect(page.getByRole("button", { name: "サインイン" })).toBeVisible();
  });

  test("ブラウザで断ったら、断ったと出て［サインイン］に戻る。［やめる］で待つのをやめる", async ({ page }) => {
    await page.addInitScript(() => ((globalThis as { __novelaiTestGithubClientId?: string }).__novelaiTestGithubClientId = "Ov-e2e"));
    const seen = await fakeGitHub(page, [{ error: "access_denied" }]);
    await openWithWorks(page, "#/github");
    await page.getByRole("button", { name: "サインイン" }).click();
    await expect(page.locator(".gh-state")).toContainText("GitHub で断りました", { timeout: 10_000 });
    await page.getByRole("button", { name: "サインイン" }).click();
    await expect(page.locator(".gh-code")).toBeVisible();
    await page.getByRole("button", { name: "やめる" }).click();
    await expect(page.getByRole("button", { name: "サインイン" })).toBeVisible();
    const asked = seen.length;
    await page.waitForTimeout(2_500);
    expect(seen.length).toBe(asked);
  });
});
