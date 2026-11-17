import { expect, test, type Page } from "@playwright/test";
import { FAKE_WORKS, openWithWorks, readFakeFile } from "./support/fakeWorks";

/**
 * **誤字脱字（段2）**：［提案］→ 誤字脱字 → 見積もり（F）→ 有料の確認 → 指摘は［提案］へ → 採ると本文が直る。
 * Anthropic は偽物（どこにも送らない）。鍵は作り物。作品は作り物（`_確認用`）だけ
 */
const FIRST = "灯台守_確認用/本文/第1話 手紙.txt";
const BODY = "姉から手紙がが届いた。\n";
const WORKS = { ...FAKE_WORKS, [FIRST]: BODY };
const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "*" };

async function setUpClaude(page: Page): Promise<void> {
  await page.route("https://api.anthropic.com/v1/models**", (route) =>
    route.fulfill({ headers: CORS, contentType: "application/json", body: JSON.stringify({ data: [{ id: "claude-a" }] }) })
  );
  await openWithWorks(page, "#/ai", WORKS);
  await page.locator('[data-ai-set="claude"]').click();
  await page.locator("#dialogInput").fill("sk-ant-tukurimono-typo");
  await page.locator('[data-answer="yes"]').click();
  await page.locator("[data-ai-default]").click();
  await page.locator('[data-choice="claude"]').click();
  await page.locator('[data-choice="claude-a"]').click();
  await expect(page.locator("#aiDefault")).toContainText("claude-a");
}

async function openFirstEpisode(page: Page): Promise<void> {
  await page.evaluate(() => (location.hash = "#/works"));
  await page.locator(".work-card", { hasText: "灯台守の手紙_確認用" }).click();
  await page.locator(".ep-list .ep").first().click();
  await expect(page.locator("#msEditor")).toBeVisible();
  await page.locator(".appbar-back").click();
}

test.describe("誤字脱字", () => {
  test("見積もりの4行 → 確認の窓 → 指摘を［提案］に並べ、採ると本文のその字だけが直る", async ({ page }) => {
    const sent: { url: string; key: string | null; body: Record<string, unknown> }[] = [];
    await page.route("https://api.anthropic.com/v1/messages", (route) => {
      if (route.request().method() === "OPTIONS") return route.fulfill({ headers: CORS });
      sent.push({ url: route.request().url(), key: route.request().headers()["x-api-key"] ?? null, body: route.request().postDataJSON() });
      const issues = [{ line: 1, original: "姉から手紙がが届いた。", target: "がが", suggestion: "が", reason: "衍字", confidence: "high" }];
      return route.fulfill({ headers: CORS, contentType: "application/json", body: JSON.stringify({ content: [{ type: "text", text: JSON.stringify({ issues }) }], stop_reason: "end_turn" }) });
    });
    await setUpClaude(page);
    await openFirstEpisode(page);

    await page.locator('#tabbar [data-tab="proposals"]').click();
    await page.locator("[data-typo-path]").click();
    await expect(page).toHaveURL(/#\/typo\//);
    const rows = page.locator(".estimate dt");
    await expect(rows).toHaveText(["話", "字数", "AI", "料金"]);
    await expect(page.locator(".estimate")).toContainText("第1話 手紙");
    await expect(page.locator(".estimate")).toContainText("Claude・claude-a");
    await expect(page.locator(".estimate")).toContainText("1 回");

    await page.locator("#typoRun").click();
    await expect(page.locator(".paid-lines")).toBeVisible();
    await page.locator('[data-answer="yes"]').click();
    await expect(page.locator("#typoProgress")).toHaveText("指摘 1件");
    expect(sent).toHaveLength(1);
    expect(sent[0]!.url).not.toContain("sk-ant");
    expect(sent[0]!.key).toBe("sk-ant-tukurimono-typo");
    expect(JSON.stringify(sent[0]!.body)).toContain("1: 姉から手紙がが届いた。");

    await page.locator('[data-tab="proposals"]').last().click();
    const item = page.locator(".proposal");
    await expect(item).toHaveCount(1);
    await expect(item.locator("mark")).toHaveText("がが");
    await item.locator("[data-accept]").click();
    await expect(page.locator("#toast")).toHaveText("本文を直しました");
    await expect(page.locator(".proposal")).toHaveCount(0);
    expect(await readFakeFile(page, FIRST)).toBe("姉から手紙が届いた。\n");
  });

  test("確認の窓でやめたら送らない。見送ると本文は変えずに一覧から消える", async ({ page }) => {
    let calls = 0;
    await page.route("https://api.anthropic.com/v1/messages", (route) => {
      calls++;
      return route.fulfill({ headers: CORS, contentType: "application/json", body: "{}" });
    });
    await setUpClaude(page);
    await openFirstEpisode(page);
    await page.locator('#tabbar [data-tab="proposals"]').click();
    await page.locator("[data-typo-path]").click();
    await page.locator("#typoRun").click();
    await page.locator('[data-answer="no"]').click();
    await expect(page.locator(".paid-lines")).toHaveCount(0);
    expect(calls).toBe(0);

    // 前に出ていた指摘を見送る
    await page.evaluate((path) => {
      const item = { root: "灯台守_確認用", id: "x", path, line: 1, original: "姉から手紙がが届いた。", target: "がが", suggestion: "が", reason: "衍字", confidence: "high" };
      localStorage.setItem("novelai.proposals.typo", JSON.stringify([item]));
    }, FIRST);
    await page.evaluate(() => (location.hash = "#/proposals"));
    await page.locator("[data-dismiss]").click();
    await expect(page.locator(".proposal")).toHaveCount(0);
    expect(await readFakeFile(page, FIRST)).toBe(BODY);
  });

  test("［提案］を何度開いても、［採る］は1回だけ当たる", async ({ page }) => {
    await openWithWorks(page, "#/works", { ...WORKS, [FIRST]: "姉から手紙がががが届いた。" + String.fromCharCode(10) });
    await page.evaluate((path) => {
      const item = { root: "灯台守_確認用", id: "x", path, line: 1, original: "姉から手紙がががが届いた。", target: "がが", suggestion: "が", reason: "衍字", confidence: "high" };
      localStorage.setItem("novelai.proposals.typo", JSON.stringify([item]));
    }, FIRST);
    for (const tab of ["proposals", "works", "proposals", "other", "proposals"]) await page.locator(`#tabbar [data-tab="${tab}"]`).click();
    // 出た知らせをすべて控える（聞き手が重なると、2回目の［採る］が「読んだあとで本文が変わった」と出る）
    await page.evaluate(() => {
      const seen: string[] = [];
      (window as unknown as { toasts: string[] }).toasts = seen;
      new MutationObserver(() => seen.push(document.querySelector("#toast")!.textContent ?? "")).observe(document.querySelector("#toast")!, { childList: true, characterData: true, subtree: true });
    });
    await page.locator("[data-accept]").click();
    await expect(page.locator("#toast")).toHaveText("本文を直しました");
    await page.waitForTimeout(800);
    expect(await page.evaluate(() => (window as unknown as { toasts: string[] }).toasts)).toEqual(["本文を直しました"]);
    expect(await readFakeFile(page, FIRST)).toBe("姉から手紙ががが届いた。" + String.fromCharCode(10));
  });

  test("AI を選んでいなければ走らせず、設定へ案内する", async ({ page }) => {
    await openWithWorks(page, "#/works", WORKS);
    await openFirstEpisode(page);
    await page.locator('#tabbar [data-tab="proposals"]').click();
    await page.locator("[data-typo-path]").click();
    await expect(page.locator("#typoProblem")).toHaveText("誤字脱字に使う AI がまだありません");
    await expect(page.locator("#typoRun")).toHaveCount(0);
    await expect(page.locator('[data-screen="ai"]')).toBeVisible();
  });
});

test("写真：見積もりと提案（撮るだけ）", async ({ page }, info) => {
  test.skip(info.project.name !== "phone-light" || !process.env.SHOTS, "SHOTS=1 のときだけ撮る");
  await page.route("https://api.anthropic.com/v1/messages", (route) => {
    if (route.request().method() === "OPTIONS") return route.fulfill({ headers: CORS });
    const issues = [{ line: 1, original: "姉から手紙がが届いた。", target: "がが", suggestion: "が", reason: "衍字", confidence: "high" }];
    return route.fulfill({ headers: CORS, contentType: "application/json", body: JSON.stringify({ content: [{ type: "text", text: JSON.stringify({ issues }) }], stop_reason: "end_turn" }) });
  });
  await setUpClaude(page);
  await openFirstEpisode(page);
  await page.locator('#tabbar [data-tab="proposals"]').click();
  await page.locator("[data-typo-path]").click();
  await expect(page.locator(".estimate")).toBeVisible();
  await page.screenshot({ path: "docs/画面の写真/案/誤字脱字-見積もり.png" });
  await page.locator("#typoRun").click();
  await page.locator('[data-answer="yes"]').click();
  await expect(page.locator("#typoProgress")).toHaveText("指摘 1件");
  await page.locator('[data-tab="proposals"]').last().click();
  await expect(page.locator(".proposal")).toHaveCount(1);
  await page.screenshot({ path: "docs/画面の写真/案/誤字脱字-提案.png" });
});
