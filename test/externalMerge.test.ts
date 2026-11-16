import { describe, expect, test } from "vitest";
import { finishMerge, planExternalMerge, regionChoices, renderMergeChoices, type ExternalMergePlan } from "../src/app/externalMerge";

/** 「外で変わりました」のときの合わせ方（`src/app/externalMerge.ts`。本体の driveTextMerge を使う。引継ぎ書 76章） */

const base = "一。\n二。\n三。\n四。\n五。\n";
const plan = (ours: string, theirs: string) => {
  const result = planExternalMerge({ base, ours, theirs });
  if (result.kind !== "merge") throw new Error(result.reason);
  return result;
};

describe("重ならない所は反映、重なる所だけ選ばせる", () => {
  test("こちらは一を、あちらは五を変えた：選ぶ所は無く、両方の変更が入る", () => {
    const p = plan("一。書き足した。\n二。\n三。\n四。\n五。\n", "一。\n二。\n三。\n四。\n五。あちら。\n");
    expect(p.merge.regions).toEqual([]);
    expect(finishMerge(p, [], base)).toEqual({ ok: true, text: "一。書き足した。\n二。\n三。\n四。\n五。あちら。\n" });
  });

  test("両方が三を違うように変えた：そこだけ選ぶ。こちら・あちらのどちらの文も、そのまま写したもの", () => {
    const p = plan("一。\n二。\n三。こちら。\n四。\n五。\n", "一。\n二。\n三。あちら。\n四。\n五。あちら。\n");
    const choices = regionChoices(p);
    expect(choices).toHaveLength(1);
    expect(choices[0]!.ours!.lines).toEqual(["三。こちら。"]);
    expect(choices[0]!.theirs!.lines).toEqual(["三。あちら。"]);
    expect(finishMerge(p, [choices[0]!.ours!.option], base)).toEqual({ ok: true, text: "一。\n二。\n三。こちら。\n四。\n五。あちら。\n" });
    expect(finishMerge(p, [choices[0]!.theirs!.option], base)).toEqual({ ok: true, text: "一。\n二。\n三。あちら。\n四。\n五。あちら。\n" });
    // 選びが足りなければ組まない
    expect(finishMerge(p, [], base)).toMatchObject({ ok: false });
  });

  test("同じ字なら、選ぶ所は無い。CRLF でも行で比べる。競合の印があれば合わせない", () => {
    const same = plan("一。\n二。\n三。同じ。\n四。\n五。\n", "一。\r\n二。\r\n三。同じ。\r\n四。\r\n五。\r\n");
    expect(same.merge.regions).toEqual([]);
    expect(finishMerge(same, [], base)).toEqual({ ok: true, text: "一。\n二。\n三。同じ。\n四。\n五。\n" });
    expect(planExternalMerge({ base, ours: "<<<<<<< ours\n一\n=======\n二\n>>>>>>> theirs\n", theirs: base })).toMatchObject({ kind: "unmergeable" });
  });

  test("選ぶ画面：重なった所ごとに［こちら］［あちら］。全部選ぶまで［合わせて保存］は押せない", () => {
    const p: ExternalMergePlan = plan("一。\n二。\n三。こちら。\n四。\n五。\n", "一。\n二。\n三。<あちら>\n四。\n五。\n");
    const choices = regionChoices(p);
    const before = renderMergeChoices(choices, [undefined]);
    expect(before).toContain("外の変更と、書きかけが重なった所：1");
    expect(before).toContain(`data-merge-pick="ours" aria-pressed="false"`);
    expect(before).toContain("三。&lt;あちら&gt;");
    expect(before).toContain("data-merge-save disabled");
    expect(renderMergeChoices(choices, ["theirs"])).not.toContain("data-merge-save disabled");
  });
});
