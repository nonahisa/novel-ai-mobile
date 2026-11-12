import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { TABS } from "../src/app/menuPlan";
import { renderAppBar, renderTabBar } from "../src/app/menuScreen";

/**
 * 画面の見本（`docs/画面デザイン.html`）に寄せた見た目の決まり（2026-11-12 作者「並びまで」）。
 * 画面に出した形は `e2e/screens.e2e.ts`（pnpm run e2e）が見る。ここは文字列と CSS の決まりだけ
 */
const css = readFileSync(new URL("../src/style.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

describe("見本の並び", () => {
  test("下のタブは4つとも絵と名前", () => {
    const bar = renderTabBar(TABS, "works");
    expect(bar.match(/<svg /g)).toHaveLength(4);
    for (const tab of TABS) expect(bar).toContain(`${tab.label}</button>`);
  });

  test("上のバーの［戻る］は絵で、読み上げには「戻る」", () => {
    const html = renderAppBar("すべての機能", { back: true, sub: "補い" });
    expect(html).toMatch(/<button class="appbar-back" data-back aria-label="戻る"><svg /);
    expect(html).toContain("<small>補い</small>");
    expect(renderAppBar("題")).not.toContain("appbar-back");
  });

  test("題の補いは escape する・id を付けられる", () => {
    expect(renderAppBar("<題>", { sub: "<b>" })).toContain("&lt;題&gt;<small>&lt;b&gt;</small>");
    expect(renderAppBar("題", { subId: "draftCount" })).toContain('<small id="draftCount"></small>');
  });
});

describe("見本の色", () => {
  test("見本の色の印を明るい・暗いの両方に置く", () => {
    for (const value of ["--accent: #2c4a8c", "--sunk: #eceff4", "--accent: #93abe8", "--sunk: #20252f"]) expect(css).toContain(value);
  });

  test("藍の地の字に #fff を直に書かない（暗い画面で読めなくなる）", () => {
    expect(css).not.toMatch(/color:\s*#fff\b/i);
  });

  test("hidden を付けた切り替えの段は出さない（.seg の display: flex に負けない）", () => {
    expect(css).toMatch(/\.seg\[hidden\][^{]*\{\s*display:\s*none/);
  });

  test("Google Fonts を読まない（書体は端末のもの）", () => {
    expect(css).not.toMatch(/fonts\.googleapis|@import/);
  });
});
