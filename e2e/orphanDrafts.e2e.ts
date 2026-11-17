import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";
import { FAKE_WORKS, listFakeFiles, openWithWorks, readFakeFile } from "./support/fakeWorks";

/**
 * **設定 → 書きかけの控え**（2026-11-18 作者の答え「一覧にして、1つずつ消せるようにする（自動では消さない）」）。
 * どの話にも合わない控えだけを、中身の頭と字数で並べる。消すのは確かめてから1つずつ。作品は作り物（`_確認用`）だけ
 */

const journal = (episodePath: string) => `.novelai-drafts/${createHash("sha256").update(episodePath, "utf8").digest("hex")}.txt`;
const LIVE = journal("灯台守_確認用/本文/第1話 手紙.txt");
const ORPHAN = journal("消した作品_確認用/本文/第1話.txt");
const FILES = {
  ...FAKE_WORKS,
  [LIVE]: "姉から手紙が届いた。書きかけ",
  [ORPHAN]: "霧の朝、灯台の窓に\n知らない船が映った。",
};

test("どの話にも合わない控えだけを並べ、確かめてから1つずつ消す。いまある話の控えは残す", async ({ page }) => {
  await openWithWorks(page, "#/other", FILES);
  await page.locator(".menu-item", { hasText: "書きかけの控え" }).click();
  await expect(page).toHaveURL(/#\/drafts$/);
  const rows = page.locator(".orphan-draft");
  await expect(rows).toHaveCount(1);
  await expect(rows.first().locator(".orphan-preview")).toHaveText("霧の朝、灯台の窓に　知らない船が映った。");
  await expect(rows.first().locator(".orphan-count")).toHaveText("20字");

  // ［やめる］なら消さない
  await rows.first().locator("[data-drop]").click();
  await expect(page.locator(".dialog-message")).toContainText("元に戻せません");
  await page.locator('.dialog [data-answer="no"]').click();
  await expect(rows).toHaveCount(1);
  expect(await readFakeFile(page, ORPHAN)).toBeDefined();

  await rows.first().locator("[data-drop]").click();
  await page.locator('.dialog [data-answer="yes"]').click();
  await expect(rows).toHaveCount(0);
  expect(await listFakeFiles(page, ".novelai-drafts/")).toEqual([LIVE]);
  expect(await readFakeFile(page, LIVE)).toBe("姉から手紙が届いた。書きかけ");
});

test("控えが無ければ、空の一覧", async ({ page }) => {
  await openWithWorks(page, "#/drafts", FAKE_WORKS);
  await expect(page.locator("#orphanSlot")).not.toHaveAttribute("aria-busy");
  await expect(page.locator(".orphan-draft")).toHaveCount(0);
});
