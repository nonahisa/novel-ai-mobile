import { expect, test } from "@playwright/test";
import { FAKE_WORKS, openWithWorks } from "./support/fakeWorks";

/**
 * **読み込んでよい相手の決まり（CSP）**（2026-11-21 作者の答え。セキュリティチェックの 9。`index.html`）。
 * escape が漏れて字が HTML として入っても、差し込まれたスクリプトは動かない。アプリの画面を回しても決まりに触れない
 */
test("差し込まれた HTML のスクリプト（onerror・script）は動かない。知らない相手へは送れない", async ({ page }) => {
  await openWithWorks(page, "#/works", FAKE_WORKS);
  const result = await page.evaluate(async () => {
    const w = window as unknown as { __injected?: number };
    document.body.insertAdjacentHTML("beforeend", `<img src="data:," onerror="window.__injected = 1"><iframe src="https://example.com"></iframe>`);
    const script = document.createElement("script");
    script.textContent = "window.__injected = 2";
    document.body.appendChild(script);
    await new Promise((resolve) => setTimeout(resolve, 300));
    let sent = "sent";
    try {
      await fetch("https://example.com/");
    } catch {
      sent = "blocked";
    }
    return { injected: w.__injected ?? 0, sent };
  });
  expect(result).toEqual({ injected: 0, sent: "blocked" });
});

test("ふだんの画面（作品・話・ほか・設定）を回しても、決まりに触れない", async ({ page }) => {
  const violations: string[] = [];
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (event) => {
      (window as unknown as { __csp?: string[] }).__csp = [...((window as unknown as { __csp?: string[] }).__csp ?? []), `${event.violatedDirective} ${event.blockedURI}`];
    });
  });
  page.on("console", (message) => {
    if (/Content Security Policy/i.test(message.text())) violations.push(message.text());
  });
  await openWithWorks(page, "#/works", FAKE_WORKS);
  await page.locator(".work-card", { hasText: "灯台守の手紙_確認用" }).click();
  await page.locator(".ep-list .ep").first().click();
  await expect(page.locator("textarea#msEditor, #msHost .ms-editor").first()).toBeVisible();
  for (const hash of ["#/other", "#/display", "#/github", "#/ai", "#/stats", "#/update", "#/tategaki", "#/check"]) {
    await page.evaluate((h) => (location.hash = h), hash);
    await page.waitForTimeout(150);
  }
  const caught = await page.evaluate(() => (window as unknown as { __csp?: string[] }).__csp ?? []);
  expect([...violations, ...caught]).toEqual([]);
});
