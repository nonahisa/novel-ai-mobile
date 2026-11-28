import { expect, test } from "@playwright/test";
import { FAKE_WORKS, openWithWorks } from "./support/fakeWorks";

/**
 * ［ほか］→［設定］→［読み上げ］（2026-11-29 作者の答え「［ほか］→［設定］に置く（選んだものは覚えておく）」）：速さと声を選ぶと覚え、
 * ［…］→ 読み上げがその速さと声で読む。声は偽物（`speechSynthesis` を差し替える。日本語の声2つと英語の声1つ）
 */
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const asked: Array<{ text: string; rate: number; voice: string | undefined }> = [];
    const voices = [
      { lang: "ja-JP", name: "声A" },
      { lang: "ja-JP", name: "声B" },
      { lang: "en-US", name: "英語の声" },
    ];
    const fake = {
      getVoices: () => voices,
      addEventListener: () => undefined,
      speak(utterance: { text: string; rate: number; voice?: { name: string } }) {
        asked.push({ text: utterance.text, rate: utterance.rate, voice: utterance.voice?.name });
      },
      cancel: () => undefined,
    };
    Object.defineProperty(window, "speechSynthesis", { value: fake, configurable: true });
    (window as unknown as { SpeechSynthesisUtterance: unknown }).SpeechSynthesisUtterance = class {
      text: string;
      lang = "";
      rate = 1;
      voice: unknown;
      onend: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(text: string) {
        this.text = text;
      }
    };
    (window as unknown as { __aloud: unknown }).__aloud = { asked };
  });
});

const asked = (page: import("@playwright/test").Page) =>
  page.evaluate(() => (window as unknown as { __aloud: { asked: Array<{ text: string; rate: number; voice: string | undefined }> } }).__aloud.asked);

test("速さと声を選ぶと覚え、読み上げがその速さと声で読む", async ({ page }) => {
  await openWithWorks(page, "#/other", FAKE_WORKS);
  await page.locator("button, a", { hasText: /^読み上げ$/ }).click();
  await expect(page).toHaveURL(/#\/aloud$/);
  // 決まり：速さ1・端末の決まりの声。日本語の声だけが並ぶ
  await expect(page.locator('[data-aloud-rate="1"]')).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("[data-aloud-voice]")).toHaveText(["端末の決まりの声", "声A", "声B"]);
  await expect(page.locator('[data-aloud-voice=""]')).toHaveAttribute("aria-pressed", "true");
  await page.locator('[data-aloud-rate="1.5"]').click();
  await page.locator('[data-aloud-voice="声B"]').click();
  await expect(page.locator('[data-aloud-rate="1.5"]')).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('[data-aloud-voice="声B"]')).toHaveAttribute("aria-pressed", "true");
  // 試しに聞く
  await page.locator("#aloudTry").click();
  await expect.poll(() => asked(page)).toEqual([{ text: "読み上げの試しです。この速さと声で、原稿を読みます。", rate: 1.5, voice: "声B" }]);

  // 開き直しても覚えている
  await page.reload();
  await expect(page.locator('[data-aloud-rate="1.5"]')).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('[data-aloud-voice="声B"]')).toHaveAttribute("aria-pressed", "true");

  // 原稿の読み上げもその速さと声
  await page.evaluate(() => (location.hash = "#/works"));
  await page.locator(".work-card", { hasText: "灯台守の手紙_確認用" }).click();
  await page.locator(".ep-list .ep").first().click();
  const editor = page.locator("textarea#msEditor");
  await expect(editor).toHaveValue(/姉から手紙が届いた。/);
  await editor.evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(0, 0));
  await page.locator("#episodeMore").click();
  await page.locator(".dialog-choices button", { hasText: "読み上げ" }).click();
  // 開き直したので、偽の声の控えは空から
  await expect.poll(() => asked(page)).toEqual([{ text: "姉から手紙が届いた。", rate: 1.5, voice: "声B" }]);
});
