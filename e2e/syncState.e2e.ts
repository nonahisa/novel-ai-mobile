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
async function workAsRepo(edits: Record<string, string> = {}): Promise<Record<string, FakeFile>> {
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
