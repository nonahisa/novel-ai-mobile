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
  // 離れるときは保存を済ませてから移る（非同期）。移り終わるまで待たないと、あとで変えた場所が上書きされる
  await expect(page).not.toHaveURL(/#\/episode\//);
  await expect(page.locator("#msEditor")).toHaveCount(0);
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

  test("Gemini でも見られる（2026-11-18 Claude 以外の AI）：鍵は頭書きだけ、指摘は［提案］へ", async ({ page }) => {
    const sent: { url: string; key: string | null; body: string }[] = [];
    await page.route("https://generativelanguage.googleapis.com/v1beta/models?**", (route) =>
      route.fulfill({ headers: CORS, contentType: "application/json", body: JSON.stringify({ models: [{ name: "models/gemini-a" }] }) })
    );
    await page.route("https://generativelanguage.googleapis.com/v1beta/models/*:generateContent", (route) => {
      if (route.request().method() === "OPTIONS") return route.fulfill({ headers: CORS });
      sent.push({ url: route.request().url(), key: route.request().headers()["x-goog-api-key"] ?? null, body: route.request().postData() ?? "" });
      const issues = [{ line: 1, original: "姉から手紙がが届いた。", target: "がが", suggestion: "が", reason: "衍字", confidence: "high" }];
      return route.fulfill({ headers: CORS, contentType: "application/json", body: JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ issues }) }] }, finishReason: "STOP" }] }) });
    });
    await openWithWorks(page, "#/ai", WORKS);
    await page.locator('[data-ai-set="gemini"]').click();
    await page.locator("#dialogInput").fill("AIza-tukurimono-typo-gemini");
    await page.locator('[data-answer="yes"]').click();
    await page.locator("[data-ai-default]").click();
    await page.locator('[data-choice="gemini"]').click();
    await page.locator('[data-choice="gemini-a"]').click();
    await expect(page.locator("#aiDefault")).toContainText("gemini-a");
    await openFirstEpisode(page);

    await page.locator('#tabbar [data-tab="proposals"]').click();
    await page.locator("[data-typo-path]").click();
    await expect(page.locator(".estimate")).toContainText("gemini-a");
    await expect(page.locator("#typoProblem")).toHaveCount(0);
    await page.locator("#typoRun").click();
    await page.locator('[data-answer="yes"]').click();
    await expect(page.locator("#typoProgress")).toHaveText("指摘 1件");
    expect(sent).toHaveLength(1);
    expect(sent[0]!.url).not.toContain("AIza");
    expect(sent[0]!.url).toContain("/models/gemini-a:generateContent");
    expect(sent[0]!.key).toBe("AIza-tukurimono-typo-gemini");
    expect(sent[0]!.body).toContain("1: 姉から手紙がが届いた。");
    await page.locator('[data-tab="proposals"]').last().click();
    await expect(page.locator(".proposal mark")).toHaveText("がが");
  });

  test("話の一覧で話を長押しすると、その話の誤字脱字へ（設計書 4.4）。短く押せば話が開く", async ({ page }) => {
    await openWithWorks(page, "#/works", WORKS);
    await page.locator(".work-card", { hasText: "灯台守の手紙_確認用" }).click();
    const episode = page.locator(".ep-list .ep").first();
    const box = (await episode.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(700);
    await page.mouse.up();
    // 長押しのあとの click で話を開かない
    const choices = page.locator(".dialog-choices button", { hasText: "誤字脱字" });
    await expect(choices).toBeVisible();
    await expect(page).not.toHaveURL(/#\/episode\//);
    await choices.click();
    await expect(page).toHaveURL(/#\/typo\//);
    await expect(page.locator(".estimate")).toContainText("第1話 手紙");

    await page.evaluate(() => (location.hash = "#/works"));
    await page.locator(".work-card", { hasText: "灯台守の手紙_確認用" }).click();
    await page.locator(".ep-list .ep").first().click();
    await expect(page).toHaveURL(/#\/episode\//);
  });

  test("すべての機能の［誤字脱字検知］は［提案］を開き、最後に開いた話の誤字脱字の入口が頭にある", async ({ page }) => {
    await openWithWorks(page, "#/works", WORKS);
    await openFirstEpisode(page);
    await page.evaluate(() => (location.hash = "#/all"));
    await page.locator(".menu-item.built", { hasText: "誤字脱字検知" }).click();
    await expect(page).toHaveURL(/#\/proposals$/);
    await expect(page.locator("[data-typo-path]")).toContainText("第1話 手紙");
  });

  test("推敲（2026-11-18）：［提案］の頭から走らせ、観点と説明つきの指摘が並び、採ると本文が直る。誤字脱字の指摘は残る", async ({ page }) => {
    const prompts: string[] = [];
    await page.route("https://api.anthropic.com/v1/messages", (route) => {
      if (route.request().method() === "OPTIONS") return route.fulfill({ headers: CORS });
      const body = route.request().postDataJSON() as { system: string };
      prompts.push(body.system);
      const proofread = body.system.includes("読みにくい");
      const issues = proofread
        ? [{ line: 1, original: "姉から手紙がが届いた。", target: "姉から手紙がが届いた。", suggestion: "姉から手紙が届いた。", reason: "冗長", explanation: "「がが」が重なっている", confidence: "high" }]
        : [{ line: 1, original: "姉から手紙がが届いた。", target: "がが", suggestion: "が", reason: "衍字", confidence: "high" }];
      return route.fulfill({ headers: CORS, contentType: "application/json", body: JSON.stringify({ content: [{ type: "text", text: JSON.stringify({ issues }) }], stop_reason: "end_turn" }) });
    });
    await setUpClaude(page);
    await openFirstEpisode(page);
    // 先に誤字脱字
    await page.locator('#tabbar [data-tab="proposals"]').click();
    await page.locator("[data-typo-path]").click();
    await page.locator("#typoRun").click();
    await page.locator('[data-answer="yes"]').click();
    await expect(page.locator("#typoProgress")).toHaveText("指摘 1件");
    // つぎに推敲
    await page.locator('#tabbar [data-tab="proposals"]').click();
    await page.locator("[data-proofread-path]").click();
    await expect(page).toHaveURL(/#\/proofread\//);
    await expect(page.locator(".appbar-title")).toContainText("推敲");
    await page.locator("#typoRun").click();
    await page.locator('[data-answer="yes"]').click();
    await expect(page.locator("#typoProgress")).toHaveText("指摘 1件");
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).not.toBe(prompts[0]);

    await page.locator('[data-tab="proposals"]').last().click();
    const items = page.locator(".proposal");
    await expect(items).toHaveCount(2);
    const proofreadItem = page.locator('.proposal[data-kind="proofread"]');
    await expect(proofreadItem.locator(".proposal-why")).toContainText("推敲・冗長：「がが」が重なっている");
    await proofreadItem.locator("[data-accept]").click();
    await expect(page.locator("#toast")).toHaveText("本文を直しました");
    expect(await readFakeFile(page, FIRST)).toBe("姉から手紙が届いた。\n");
    // 誤字脱字の指摘は消えずに残る（本文が直ったので、採ろうとすると外れる）
    await expect(page.locator('.proposal[data-kind="typo"]')).toHaveCount(1);
  });

  test("何話かまとめて（2026-11-18 母艦の順 C）：［話を選ぶ］で話を選び、選んだ話ごとに見て［提案］へ。競合の話は選べない", async ({ page }) => {
    const bodies: string[] = [];
    await page.route("https://api.anthropic.com/v1/messages", (route) => {
      if (route.request().method() === "OPTIONS") return route.fulfill({ headers: CORS });
      const body = JSON.stringify(route.request().postDataJSON());
      bodies.push(body);
      const issues = body.includes("姉から手紙がが届いた")
        ? [{ line: 1, original: "姉から手紙がが届いた。", target: "がが", suggestion: "が", reason: "衍字", confidence: "high" }]
        : [];
      return route.fulfill({ headers: CORS, contentType: "application/json", body: JSON.stringify({ content: [{ type: "text", text: JSON.stringify({ issues }) }], stop_reason: "end_turn" }) });
    });
    await setUpClaude(page);
    await openFirstEpisode(page);
    await page.locator('#tabbar [data-tab="proposals"]').click();
    await page.locator("[data-typo-path]").click();
    await page.locator("#typoPick").click();
    const rows = page.locator(".pick-list .pick-row");
    await expect(rows).toHaveCount(4);
    await expect(rows.filter({ hasText: "第4話 港" }).locator("input")).toBeDisabled();
    await expect(rows.filter({ hasText: "第1話 手紙" }).locator("input")).toBeChecked();
    await page.locator("#pickAll").check();
    await expect(page.locator(".pick-list input:checked")).toHaveCount(3);
    await page.locator("#pickDone").click();
    await expect(page.locator(".estimate")).toContainText("3話（第1話 手紙 ほか）");
    await expect(page.locator(".estimate")).toContainText("3 回");
    await page.locator("#typoRun").click();
    await expect(page.locator(".paid-lines")).toContainText("3話");
    await page.locator('[data-answer="yes"]').click();
    await expect(page.locator("#typoProgress")).toHaveText("指摘 1件");
    expect(bodies).toHaveLength(3);
    expect(bodies.some((b) => b.includes("階段をのぼる"))).toBe(true);
    expect(bodies.some((b) => b.includes("霧が出た"))).toBe(true);
    await page.locator('[data-tab="proposals"]').last().click();
    await expect(page.locator(".proposal")).toHaveCount(1);
  });

  test("範囲で選ぶ（2026-11-18 作者の答え）：頭と末を選んで［この範囲を選ぶ］。競合の話は入らない", async ({ page }) => {
    await setUpClaude(page);
    await openFirstEpisode(page);
    await page.locator('#tabbar [data-tab="proposals"]').click();
    await page.locator("[data-typo-path]").click();
    await page.locator("#typoPick").click();
    await page.locator("#pickFrom").selectOption({ label: "第2話 灯台の階段は百二十段あり、のぼるたびに数え直してしまう" });
    await page.locator("#pickTo").selectOption({ label: "第4話 港" });
    await page.locator("#pickRangeApply").click();
    await expect(page.locator(".pick-list input:checked")).toHaveCount(2);
    await expect(page.locator(".pick-list .pick-row", { hasText: "第1話 手紙" }).locator("input")).not.toBeChecked();
    await page.locator("#pickDone").click();
    await expect(page.locator(".estimate")).toContainText("2話（第2話");
  });

  test("iOS で裏に回したら（2026-11-18 作者の答え 案A）：いまの1回で止め、戻ったら残りの話だけ見積もりからやり直せる", async ({ page }) => {
    await page.addInitScript(() => ((globalThis as { __novelaiTestPauseWhenHidden?: boolean }).__novelaiTestPauseWhenHidden = true));
    const bodies: string[] = [];
    let hideOnce = true;
    await page.route("https://api.anthropic.com/v1/messages", async (route) => {
      if (route.request().method() === "OPTIONS") return route.fulfill({ headers: CORS });
      bodies.push(JSON.stringify(route.request().postDataJSON()));
      if (hideOnce) {
        hideOnce = false;
        // 1回目を頼んでいるあいだに、裏に回す
        await page.evaluate(() => {
          Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
          document.dispatchEvent(new Event("visibilitychange"));
        });
      }
      const issues = bodies.at(-1)!.includes("姉から手紙がが届いた")
        ? [{ line: 1, original: "姉から手紙がが届いた。", target: "がが", suggestion: "が", reason: "衍字", confidence: "high" }]
        : [];
      return route.fulfill({ headers: CORS, contentType: "application/json", body: JSON.stringify({ content: [{ type: "text", text: JSON.stringify({ issues }) }], stop_reason: "end_turn" }) });
    });
    await setUpClaude(page);
    await openFirstEpisode(page);
    await page.locator('#tabbar [data-tab="proposals"]').click();
    await page.locator("[data-typo-path]").click();
    await page.locator("#typoPick").click();
    await page.locator("#pickAll").check();
    await page.locator("#pickDone").click();
    await page.locator("#typoRun").click();
    await page.locator('[data-answer="yes"]').click();
    await expect(page.locator("#typoPaused")).toContainText("裏に回したので「第2話");
    await expect(page.locator("#typoPaused")).toContainText("続きを走らせますか");
    expect(bodies).toHaveLength(1);
    await expect(page.locator(".estimate")).toContainText("2話（第2話");
    // 戻ってから、残りを走らせる
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await page.locator("#typoRun").click();
    await page.locator('[data-answer="yes"]').click();
    await expect(page.locator("#typoProgress")).toHaveText("指摘 0件");
    expect(bodies).toHaveLength(3);
    // 1話目の指摘は残っている
    await page.locator('[data-tab="proposals"]').last().click();
    await expect(page.locator(".proposal")).toHaveCount(1);
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
