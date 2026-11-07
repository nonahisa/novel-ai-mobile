import { describe, expect, test } from "vitest";
import { ACTION_TREE } from "../src/shared";
import {
  BUILT_ACTIONS,
  HIDDEN_ON_MOBILE,
  TABS,
  buildActionList,
  hiddenActions,
  searchActions,
  type ScreenId,
} from "../src/app/menuPlan";
import { NOT_BUILT_MESSAGE, renderActionRows, renderTab, renderTabBar } from "../src/app/menuScreen";
import { parseRoute } from "../src/app/shell";

/**
 * 予定している画面とメニュー（設計書 4.3・4.4.1〜4.4.3 の【案】。作者の頼み 2026-11-07）。
 * 作ってある項目だけが画面を開き、ほかは灰色で「まだ作っていません」と出ることを見張る。
 */

const SCREENS: readonly ScreenId[] = ["tategaki", "check", "allActions"];

/** 本体の木の操作の名前を全部 */
function bodyLabels(): Set<string> {
  const labels = new Set<string>();
  for (const group of ACTION_TREE)
    for (const entry of group.entries) {
      if (entry.kind === "section") for (const item of entry.items) labels.add(item.label);
      else labels.add(entry.label);
    }
  return labels;
}

describe("下のタブ（4.3）", () => {
  test("4つ：作品・書く・提案・ほか の順", () => {
    expect(TABS.map((t) => t.label)).toEqual(["作品", "書く", "提案", "ほか"]);
  });

  test("作ってある項目は、知っている画面だけを開く", () => {
    const built = TABS.flatMap((t) => t.sections.flatMap((s) => s.items)).filter((i) => i.built);
    for (const item of built) expect(SCREENS).toContain(item.built);
    expect(built.map((i) => i.label)).toEqual(["縦書き・横書きの試し", "すべての機能", "動作確認ページ", "バージョン確認"]);
  });

  test("本体の操作を名指しする項目は、本体の詳細メニューにある名前", () => {
    const labels = bodyLabels();
    const named = TABS.flatMap((t) => t.sections.flatMap((s) => s.items)).filter((i) => i.action);
    expect(named.length).toBeGreaterThan(10);
    for (const item of named) expect(labels, item.action).toContain(item.action);
  });

  test("灰色の項目は押すと「まだ作っていません」と出し、作ってある項目は画面を開く", () => {
    const html = renderTab(TABS.find((t) => t.id === "write")!);
    expect(html).toContain('data-screen="tategaki"');
    const planned = [...html.matchAll(/<button class="menu-item planned" aria-disabled="true" data-planned="([^"]+)"/g)];
    expect(planned.length).toBeGreaterThan(5);
    for (const [, tell] of planned) expect(tell.startsWith(NOT_BUILT_MESSAGE)).toBe(true);
    // 押せる形のまま（disabled にすると、なぜ灰色かを確かめられない）
    expect(html).not.toMatch(/\sdisabled[\s>]/);
  });

  test("いまのタブに印が付く", () => {
    const bar = renderTabBar(TABS, "proposals");
    expect(bar.match(/aria-current="page"/g)).toHaveLength(1);
    expect(bar).toContain('class="tab current" data-tab="proposals"');
  });
});

describe("すべての機能（4.4.1 の3段目）", () => {
  const list = buildActionList();

  test("本体の詳細メニューから作り、名前は本体と同じ字", () => {
    const labels = bodyLabels();
    expect(list.length).toBeGreaterThan(60);
    for (const entry of list) expect(labels).toContain(entry.label);
  });

  test("端末で出さないもの（4.4.2）は載せず、理由つきで別に並べる", () => {
    const names = new Set(list.map((e) => e.label));
    for (const label of ["PDF出力", "EPUBエディター", "フォルダー登録", "未登録作品検索", "Claude Code接続", "編集者へ渡す", "改行コード統一"]) {
      expect(names.has(label), label).toBe(false);
    }
    expect(list.some((e) => e.group === "電子出版等" || e.section === "編集者連携")).toBe(false);
    const hidden = hiddenActions();
    expect(hidden.map((h) => h.label)).toEqual(expect.arrayContaining(["PDF出力", "フォルダー登録", "Claude Code接続"]));
    for (const h of hidden) expect(h.reason.length).toBeGreaterThan(0);
    // 出さない理由の表の名前は、本体の木の名前か分類の名前（書き間違えると黙って出てしまう）
    const groups = new Set(ACTION_TREE.map((g) => g.label));
    const sections = new Set(ACTION_TREE.flatMap((g) => g.entries.filter((e) => e.kind === "section").map((e) => `${g.label}/${e.label}`)));
    const labels = bodyLabels();
    for (const key of Object.keys(HIDDEN_ON_MOBILE)) expect(groups.has(key) || sections.has(key) || labels.has(key), key).toBe(true);
  });

  test("どの行にも置き場が付き、作ってあるものは画面を開く", () => {
    for (const entry of list) expect(entry.place.length).toBeGreaterThan(0);
    for (const [label, screen] of Object.entries(BUILT_ACTIONS)) {
      expect(list.find((e) => e.label === label)?.built).toBe(screen);
    }
    const html = renderActionRows(list);
    expect(html.match(/data-screen=/g)).toHaveLength(Object.keys(BUILT_ACTIONS).length);
    expect(html.match(/data-planned=/g)).toHaveLength(list.length - Object.keys(BUILT_ACTIONS).length);
  });

  test("検索：2〜3文字で絞れる・空白で区切ると全部を含む行・全角英数字も当たる", () => {
    expect(searchActions(list, "").length).toBe(list.length);
    expect(searchActions(list, "誤字").map((e) => e.label)).toContain("誤字脱字検知");
    expect(searchActions(list, "相関").map((e) => e.label)).toContain("人物相関図");
    expect(searchActions(list, "ＧＩＴＨＵＢ").length).toBeGreaterThan(0);
    const both = searchActions(list, "資料 人物");
    expect(both.length).toBeGreaterThan(0);
    for (const e of both) {
      const hay = `${e.label} ${e.group} ${e.section ?? ""} ${e.detail}`;
      expect(hay).toContain("資料");
      expect(hay).toContain("人物");
    }
    expect(renderActionRows(searchActions(list, "あるはずのない語"))).toContain("当てはまる機能がありません");
  });

  test("名前に < などが入っても、画面の HTML を壊さない", () => {
    const html = renderActionRows([{ label: "<b>x</b>", group: "g", detail: "", usesAI: false, place: "p" }]);
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(html).not.toContain("<b>");
  });
});

describe("画面の切り替え（#/…）", () => {
  test("知らない名前・空はいちばん左のタブ", () => {
    expect(parseRoute("")).toMatchObject({ kind: "tab", tab: { id: "works" } });
    expect(parseRoute("#/nothing")).toMatchObject({ kind: "tab", tab: { id: "works" } });
    expect(parseRoute("#/other")).toMatchObject({ kind: "tab", tab: { id: "other" } });
    expect(parseRoute("#/tategaki")).toEqual({ kind: "tategaki" });
    expect(parseRoute("#/check")).toEqual({ kind: "check" });
    expect(parseRoute("#/all")).toEqual({ kind: "all" });
  });
});
