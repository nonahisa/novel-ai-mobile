import { expect, test } from "@playwright/test";
import git from "isomorphic-git";
import nodeFs from "node:fs";
import os from "node:os";
import path from "node:path";
import { FAKE_WORKS, openWithWorks, type FakeFile } from "./support/fakeWorks";

/**
 * **作品の同期の状態**（`src/platform/workSync.ts`。設計書 6章。見本の作品一覧の「送っていない話：1」「同期済み」）。
 * 作り物の作品（`_確認用`）を node の isomorphic-git でリポジトリにし、`.git` ごと端末の置き場（ブラウザの IndexedDB）へ置く
 */

const WORK = "灯台守_確認用";
const author = { name: "確認用", email: "check@example.invalid", timestamp: 1_763_200_000, timezoneOffset: -540 };

/** FAKE_WORKS の作品をリポジトリにして、`.git` を含む全部のファイルを返す（`edits` は記録したあとに書き換える） */
async function workAsRepo(edits: Record<string, string> = {}, remote?: string): Promise<Record<string, FakeFile>> {
  const tmp = nodeFs.mkdtempSync(path.join(os.tmpdir(), "novelai-sync-"));
  const dir = path.join(tmp, WORK);
  try {
    const own = Object.entries(FAKE_WORKS).filter(([p]) => p.startsWith(`${WORK}/`));
    for (const [p, text] of own) {
      const file = path.join(tmp, p);
      nodeFs.mkdirSync(path.dirname(file), { recursive: true });
      nodeFs.writeFileSync(file, text as string);
    }
    await git.init({ fs: nodeFs, dir, defaultBranch: "main" });
    for (const [p] of own) await git.add({ fs: nodeFs, dir, filepath: p.slice(WORK.length + 1) });
    await git.commit({ fs: nodeFs, dir, message: "はじめ\n", author, committer: author });
    if (remote) await git.setConfig({ fs: nodeFs, dir, path: "remote.origin.url", value: remote });
    for (const [p, text] of Object.entries(edits)) nodeFs.writeFileSync(path.join(tmp, p), text);
    const files: Record<string, FakeFile> = { ...FAKE_WORKS };
    const walk = (folder: string) => {
      for (const name of nodeFs.readdirSync(folder)) {
        const full = path.join(folder, name);
        if (nodeFs.statSync(full).isDirectory()) walk(full);
        else files[path.relative(tmp, full).split(path.sep).join("/")] = { base64: nodeFs.readFileSync(full).toString("base64") };
      }
    };
    walk(dir);
    return files;
  } finally {
    nodeFs.rmSync(tmp, { recursive: true, force: true });
  }
}

test.describe("作品の同期の状態", () => {
  test("送っていない話があれば数と、最後に書いた日をその話の日に。git で持っていない作品には出さない", async ({ page }) => {
    await openWithWorks(page, "#/works", await workAsRepo({ [`${WORK}/本文/第1話 手紙.txt`]: "書き足した。\n" }));
    const card = page.locator(".work-card", { hasText: "灯台守の手紙_確認用" });
    await expect(card.locator("[data-sync-flag]")).toHaveText("送っていない話：1");
    await expect(card).toContainText("最後に書いた日：今日");
    await expect(page.locator(".work-card", { hasText: "雨の駅" }).locator("[data-sync-flag]")).toHaveCount(0);
    await card.click();
    await expect(page.locator("#episodeSlot [data-sync-flag]")).toHaveText("送っていない話：1");
  });

  test("そろっていれば「同期済み」", async ({ page }) => {
    await openWithWorks(page, "#/works", await workAsRepo());
    await expect(page.locator(".work-card", { hasText: "灯台守の手紙_確認用" }).locator("[data-sync-flag]")).toHaveText("同期済み");
  });
});

test.describe("同期の画面（G）", () => {
  test("話の一覧の印を押すと開き、送っていない話を並べる。GitHub の置き場が分からなければ［送る］は灰色、話を押すと開く", async ({ page }) => {
    await openWithWorks(page, "#/works", await workAsRepo({ [`${WORK}/本文/第1話 手紙.txt`]: "書き足した。\n" }));
    await page.locator(".work-card", { hasText: "灯台守の手紙_確認用" }).click();
    await page.locator("#episodeSlot [data-sync-flag]").click();
    await expect(page).toHaveURL(/#\/sync\//);
    await expect(page.locator(".appbar-title")).toContainText("同期");
    await expect(page.locator("#tabbar")).toBeVisible();
    await expect(page.locator(".sync-list .chap")).toHaveText("送っていない話：1");
    await page.locator(".sync-actions button", { hasText: "送る" }).dispatchEvent("click");
    await expect(page.locator("#toast")).toHaveText("この作品の GitHub の置き場が分かりません");
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    await page.locator(".sync-list .ep", { hasText: "第1話 手紙" }).click();
    await expect(page.locator("#msEditor")).toHaveValue("書き足した。\n");
  });

  test("サインインしていなければ、［送る］でサインインの画面を開く", async ({ page }) => {
    await openWithWorks(page, `#/sync/${encodeURIComponent(WORK)}`, await workAsRepo({}, "https://github.com/sakka-kakuninyou/toudai.git"));
    await page.locator(".sync-actions button", { hasText: "送る" }).click();
    await expect(page).toHaveURL(/#\/github$/);
  });

  test("サインインしていれば押せる。押すと結果を1行出す（GitHub は偽物で 401）。合言葉は URL に出ない", async ({ page }) => {
    const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "*" };
    await page.addInitScript(() => ((globalThis as { __novelaiTestGithubClientId?: string }).__novelaiTestGithubClientId = "Ov-e2e"));
    await page.route("https://github.com/login/device/code", (route) =>
      route.fulfill({
        headers: CORS,
        contentType: "application/json",
        body: JSON.stringify({ device_code: "d".repeat(40), user_code: "WDJB-MJHT", verification_uri: "https://github.com/login/device", expires_in: 900, interval: 1 }),
      })
    );
    await page.route("https://github.com/login/oauth/access_token", (route) =>
      route.fulfill({ headers: CORS, contentType: "application/json", body: JSON.stringify({ access_token: "gho_tukurimono_sync", scope: "repo" }) })
    );
    await page.route("https://api.github.com/user", (route) =>
      route.fulfill({ headers: CORS, contentType: "application/json", body: JSON.stringify({ login: "sakka-kakuninyou", id: 4321 }) })
    );
    const asked: string[] = [];
    await page.route("https://github.com/sakka-kakuninyou/**", (route) => {
      asked.push(route.request().url());
      return route.fulfill({ status: 401, headers: CORS, body: "" });
    });
    await openWithWorks(page, "#/github", await workAsRepo({}, "https://github.com/sakka-kakuninyou/toudai.git"));
    await page.getByRole("button", { name: "サインイン" }).click();
    await expect(page.locator(".gh-state")).toContainText("サインイン済み", { timeout: 10_000 });
    await page.evaluate((root) => (location.hash = `#/sync/${encodeURIComponent(root)}`), WORK);
    await page.locator("[data-sync-run=fetch]").click();
    await expect(page.locator("#syncResult")).toHaveText("GitHub にサインインし直してください。");
    expect(asked[0]).toContain("/sakka-kakuninyou/toudai.git/info/refs");
    expect(asked.join(" ")).not.toContain("gho_tukurimono_sync");
    await expect(page.locator("[data-sync-run=fetch]")).toBeEnabled();
  });

  test("そろっていれば「同期済み」だけ", async ({ page }) => {
    await openWithWorks(page, `#/sync/${encodeURIComponent(WORK)}`, await workAsRepo());
    await expect(page.locator(".sync-state")).toHaveText("同期済み");
    await expect(page.locator(".sync-list")).toHaveCount(0);
  });
});
