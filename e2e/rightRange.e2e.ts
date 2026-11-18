import { expect, test, type Page } from "@playwright/test";
import { FAKE_WORKS, openWithWorks, readFakeFile } from "./support/fakeWorks";

/**
 * **右の線の欄で範囲を選ぶ**（2026-11-18 作者の答え D「iPad で確かめてから、右の欄で範囲を選べるようにする」。
 * Mac の iPad mini シミュレーター 0.1.88 で試し1〜6が通った）。字をこの画面が描くので、範囲もこの画面が持つ。
 * 選んだ字に道具帯のルビ・傍点を振れる・打つと範囲と置き換わる・⌫ で範囲が消える。
 * EditContext の作り（パソコンの Chromium・Android の一部）と、見えない受け口の作り（iOS・AQUOS）の両方で見る。
 * 作品は作り物（`_確認用`）だけ
 */

const EPISODE = "灯台守_確認用/本文/第1話 手紙.txt";

async function openRight(page: Page): Promise<void> {
  await openWithWorks(page, "#/display", FAKE_WORKS);
  await page.locator('[data-line="right"]').click();
  await page.evaluate(() => (location.hash = "#/works"));
  await page.locator(".work-card", { hasText: "灯台守の手紙_確認用" }).click();
  await page.locator(".ep-list .ep").first().click();
  await expect(page.locator("#msEditor [data-i]").first()).toBeVisible();
}

/** 欄に描いた本文 */
const paneText = (page: Page) =>
  page.locator("#msEditor").evaluate((el) => Array.from(el.querySelectorAll("[data-i]"), (span) => span.textContent).join(""));

/**
 * `at` 字目の字の頭の側を押す（カーソルはその字の前に来る）。
 * 押した字の前にカーソルが描かれるまで待ち、来なければ押し直す（3回まで。込み合った全体の走らせで、ときどき
 * 押しがカーソルを動かさないことがあった）。範囲があるときは、範囲の端の近くの字を押すとつまみ（押せる所 44px）や
 * 範囲の近くの帯の上になり、カーソルは動かない（そう作ってある。引継ぎ書 125章）。離れた字を押すこと
 */
async function caretBefore(page: Page, at: number): Promise<void> {
  const caretThere = () =>
    page.locator("#msEditor").evaluate((el, i) => (el.querySelector(".caret")?.nextElementSibling as HTMLElement | null)?.dataset.i === String(i), at);
  for (let attempt = 0; attempt < 3; attempt++) {
    const point = await page.locator("#msEditor").evaluate((el, i) => {
      const r = el.querySelector(`[data-i="${i}"]`)!.getBoundingClientRect();
      return el.classList.contains("vertical") ? { x: r.x + r.width / 2, y: r.y + r.height * 0.2 } : { x: r.x + r.width * 0.2, y: r.y + r.height / 2 };
    }, at);
    await page.mouse.click(point.x, point.y);
    // 焦点が欄（EditContext）か受け口に入り、押した字の前にカーソルが来るまで待つ
    const ok = await expect
      .poll(async () => (await page.evaluate(() => document.activeElement?.id === "msEditor" || document.activeElement?.classList.contains("ime-sink") === true)) && (await caretThere()), { timeout: 1500 })
      .toBe(true)
      .then(() => true)
      .catch(() => false);
    if (ok) return;
  }
  expect(await caretThere()).toBe(true);
}

/** Shift を押しながら、字の進む向きへ `count` 字のばす */
async function extend(page: Page, count: number): Promise<void> {
  const vertical = await page.locator("#msEditor").evaluate((el) => el.classList.contains("vertical"));
  for (let n = 0; n < count; n++) await page.keyboard.press(vertical ? "Shift+ArrowDown" : "Shift+ArrowRight");
}

const tool = (page: Page, label: string) => page.locator("#msTools button", { hasText: label });

for (const build of ["EditContext", "受け口"] as const) {
  test.describe(`右の線の欄の範囲（${build}の作り）`, () => {
    if (build === "受け口") {
      test.beforeEach(async ({ page }) => {
        await page.addInitScript(() => {
          delete (window as unknown as { EditContext?: unknown }).EditContext;
        });
      });
    }

    test("選んだ字に印。選んだ字にルビと傍点を振れる", async ({ page }) => {
      await openRight(page);
      expect(await page.evaluate(() => "EditContext" in window)).toBe(build === "EditContext");
      await caretBefore(page, 3);
      await extend(page, 2);
      await expect(page.locator("#msEditor .sel")).toHaveCount(2);
      await expect(page.locator("#msEditor .sel")).toHaveText(["手", "紙"]);
      await tool(page, "ルビ").click();
      await expect(page.locator(".dialog-message")).toHaveText("「手紙」の読み");
      await page.locator("#dialogInput").fill("てがみ");
      await page.locator('.dialog [data-answer="yes"]').click();
      await expect.poll(() => paneText(page)).toBe("姉から{手紙|てがみ}が届いた。\n// 付箋：ここは後で直す\n");
      await expect(page.locator("#msEditor .sel")).toHaveCount(0);

      await caretBefore(page, 0);
      await extend(page, 1);
      await tool(page, "傍点").click();
      await expect.poll(() => paneText(page)).toBe("{{姉}}から{手紙|てがみ}が届いた。\n// 付箋：ここは後で直す\n");
      await expect(page.locator("#saveState")).toHaveText("保存済み", { timeout: 5000 });
      expect(await readFakeFile(page, EPISODE)).toBe("{{姉}}から{手紙|てがみ}が届いた。\n// 付箋：ここは後で直す\n");
    });

    test("範囲を選んで打つと置き換わり、⌫ で範囲が消える。押すと範囲は外れる", async ({ page }) => {
      await openRight(page);
      await caretBefore(page, 3);
      await extend(page, 2);
      await page.keyboard.type("文");
      await expect.poll(() => paneText(page)).toBe("姉から文が届いた。\n// 付箋：ここは後で直す\n");
      await expect(page.locator("#msEditor .sel")).toHaveCount(0);

      await caretBefore(page, 0);
      await extend(page, 3);
      await page.keyboard.press("Backspace");
      await expect.poll(() => paneText(page)).toBe("文が届いた。\n// 付箋：ここは後で直す\n");

      await caretBefore(page, 0);
      await extend(page, 1);
      await expect(page.locator("#msEditor .sel")).toHaveCount(1);
      // 範囲のすぐ近くの字は、つまみ（押せる所 44px）や範囲の近くの帯（0.1.110）の下になる。離れた字を押して外す
      await caretBefore(page, 17);
      await expect(page.locator("#msEditor .sel")).toHaveCount(0);
    });

    test("長押しで語を選び、つまみを引いて範囲をのばす。押すと範囲とつまみが消える", async ({ page }) => {
      await openRight(page);
      const center = (at: number) =>
        page.locator("#msEditor").evaluate((el, i) => {
          const r = el.querySelector(`[data-i="${i}"]`)!.getBoundingClientRect();
          return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
        }, at);
      const press = await center(4);
      await page.mouse.move(press.x, press.y);
      await page.mouse.down();
      await page.waitForTimeout(700);
      await page.mouse.up();
      // 長押しのあとの click でカーソルを置き直さない（範囲が残る）
      await expect(page.locator("#msEditor .sel")).toHaveText(["手", "紙"]);
      // 指を離したときに焦点が入る（キーボードが出る。2026-11-18 Mac：起こしてすぐの長押しでは打てなかった）
      await expect
        .poll(() => page.evaluate(() => document.activeElement?.id === "msEditor" || document.activeElement?.classList.contains("ime-sink") === true))
        .toBe(true);
      const handles = page.locator(".range-handle:not([hidden])");
      await expect(handles).toHaveCount(2);

      // 末のつまみを掴み、範囲の端（「紙」の後ろ）を「届」の後ろ半分まで動かす分だけ指を動かす
      // （つまみの丸は列の外にある。引くあいだは、掴んだときの指と端のずれを保って読む。2026-11-18 Mac）
      const grip = await page.locator('.range-handle[data-end="end"]').boundingBox();
      const move = await page.locator("#msEditor").evaluate((el) => {
        const vertical = el.classList.contains("vertical");
        const from = el.querySelector('[data-i="4"]')!.getBoundingClientRect();
        const to = el.querySelector('[data-i="6"]')!.getBoundingClientRect();
        const edge = vertical ? { x: from.x + from.width / 2, y: from.bottom } : { x: from.right, y: from.y + from.height / 2 };
        const goal = vertical ? { x: to.x + to.width / 2, y: to.y + to.height * 0.8 } : { x: to.x + to.width * 0.8, y: to.y + to.height / 2 };
        return { dx: goal.x - edge.x, dy: goal.y - edge.y };
      });
      const gx = grip!.x + grip!.width / 2;
      const gy = grip!.y + grip!.height / 2;
      await page.mouse.move(gx, gy);
      await page.mouse.down();
      await page.mouse.move(gx + move.dx, gy + move.dy, { steps: 6 });
      await page.mouse.up();
      await expect(page.locator("#msEditor .sel")).toHaveText(["手", "紙", "が", "届"]);
      // iOS は、長押しの click を、つまみを引き終えたあとに遅れて出すことがある（押した字に向けて）。その click で
      // カーソルを置き直して範囲を外さない（2026-11-18 Mac の iPad mini 0.1.111：つまみを離すと範囲が消えた）
      await page.waitForTimeout(700);
      await page.locator('#msEditor [data-i="4"]').dispatchEvent("click");
      await expect(page.locator("#msEditor .sel")).toHaveText(["手", "紙", "が", "届"]);

      // 選んだ範囲にそのまま傍点
      await tool(page, "傍点").click();
      await expect.poll(() => paneText(page)).toBe("姉から{{手紙が届}}いた。\n// 付箋：ここは後で直す\n");
      await expect(handles).toHaveCount(0);

      // 短く押せば範囲は作らない
      await caretBefore(page, 1);
      await caretBefore(page, 2);
      await expect(page.locator("#msEditor .sel")).toHaveCount(0);
      await expect(handles).toHaveCount(0);
    });

    test("押したことが遅れて届いても（画面を開き直した直後）、押していた長さで長押しを決める", async ({ page }) => {
      await openRight(page);
      // 2026-11-19 Mac の iPad mini 0.1.112：前の画面から開き直したあとの最初の長押しで、範囲ができなかった（「離した」）。
      // 開いた直後は描くのに忙しく、押したことが遅れて届く。押した時刻を、届いた時でなく押した時（事象の時刻）で読む
      await page.locator("#msEditor").evaluate(async (el) => {
        const span = el.querySelector('[data-i="4"]')!;
        const r = span.getBoundingClientRect();
        const init = { bubbles: true, cancelable: true, composed: true, pointerId: 7, pointerType: "touch", isPrimary: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 };
        const down = new PointerEvent("pointerdown", init);
        const busyUntil = performance.now() + 350;
        while (performance.now() < busyUntil) {
          /* 描くのに忙しい */
        }
        span.dispatchEvent(down);
        await new Promise((done) => setTimeout(done, 150));
        span.dispatchEvent(new PointerEvent("pointerup", init));
      });
      await expect(page.locator("#msEditor .sel")).toHaveText(["手", "紙"]);
    });

    test("範囲の近くに帯（設計書 4.4.1）：［ルビ］［傍点］［資料を見る］。［傍点］で選んだ字に付き、範囲が外れると帯も消える", async ({ page }) => {
      await openRight(page);
      const at = await page.locator("#msEditor").evaluate((el) => {
        const r = el.querySelector('[data-i="4"]')!.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      });
      await page.mouse.move(at.x, at.y);
      await page.mouse.down();
      await page.waitForTimeout(700);
      await page.mouse.up();
      const band = page.locator(".sel-band");
      await expect(band).toBeVisible();
      await expect(band.locator("button")).toHaveText(["ルビ", "傍点", "資料を見る"]);
      // 名前でない字で［資料を見る］は知らせる
      await band.locator('[data-band="term"]').click();
      await expect(page.locator("#toast")).toHaveText("選んだ字は、資料の名前ではありません");
      await band.locator('[data-band="emphasis"]').click();
      await expect.poll(() => paneText(page)).toBe("姉から{{手紙}}が届いた。\n// 付箋：ここは後で直す\n");
      await expect(band).toBeHidden();
    });

    test("範囲を選んで変換すると、変換中の字が範囲と置き換わる", async ({ page }) => {
      await openRight(page);
      await caretBefore(page, 3);
      await extend(page, 2);
      const cdp = await page.context().newCDPSession(page);
      await cdp.send("Input.imeSetComposition", { text: "ふみ", selectionStart: 2, selectionEnd: 2 });
      await cdp.send("Input.insertText", { text: "文" });
      await expect.poll(() => paneText(page)).toBe("姉から文が届いた。\n// 付箋：ここは後で直す\n");
    });
  });
}
