import { describe, expect, test } from "vitest";
import { badgeText, renderTabBar } from "../src/app/menuScreen";
import { TABS } from "../src/app/menuPlan";

/** 下のタブの件数（設計書 4.3「［提案］には未決の件数を付ける」） */
describe("下のタブの件数", () => {
  test("件数があるタブにだけ印。0 なら出さない。99 を超えたら 99+", () => {
    expect(renderTabBar(TABS, "works")).not.toContain("tab-badge");
    const html = renderTabBar(TABS, "works", { proposals: 3 });
    expect(html).toContain('<span class="tab-badge" aria-label="3件">3</span>');
    expect(renderTabBar(TABS, "works", { proposals: 0 })).not.toContain("tab-badge");
    expect(badgeText(120)).toBe("99+");
  });
});
