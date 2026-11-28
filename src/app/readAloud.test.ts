import { describe, expect, it } from "vitest";
import { DEFAULT_MEMO_MARKERS, memoMarkersOf } from "../shared";
import { readingMemoEdit, resumeIndexAt, readingPlanFor } from "./readAloud";

// 本体の設計書 6.42「⚑ 引っかかった」：読んでいる文の行の上に付箋の行を1行挿す（本体の `insertReadingMemo`）
describe("readingMemoEdit", () => {
  const text = "一つ目の文。\n二つ目の文。\n三つ目の文。";

  it("文の行の頭に、作品の印で「音読：ここで引っかかった」の行を挿す", () => {
    expect(readingMemoEdit(text, 2, DEFAULT_MEMO_MARKERS)).toEqual({
      kind: "insert",
      at: text.indexOf("二つ目"),
      insert: "// 音読：ここで引っかかった\n",
    });
  });

  it("囲みだけの作品は囲みで挿す", () => {
    const edit = readingMemoEdit(text, 1, memoMarkersOf(["comment"]));
    expect(edit).toEqual({ kind: "insert", at: 0, insert: "<!-- 音読：ここで引っかかった -->\n" });
  });

  it("直前の行がもう同じ印なら挿さない（止めて続けたあとに同じ文でもう一度押したとき）", () => {
    const marked = "一つ目の文。\n// 音読：ここで引っかかった\n二つ目の文。";
    expect(readingMemoEdit(marked, 3, DEFAULT_MEMO_MARKERS)).toEqual({ kind: "already" });
  });

  it("作者が書いた別のメモの上には挿す", () => {
    const memo = "一つ目の文。\n// ここは直す\n二つ目の文。";
    expect(readingMemoEdit(memo, 3, DEFAULT_MEMO_MARKERS).kind).toBe("insert");
  });

  it("行番号が読めなければ先頭、多すぎれば最後の行の頭", () => {
    expect(readingMemoEdit(text, Number.NaN, DEFAULT_MEMO_MARKERS)).toMatchObject({ at: 0 });
    expect(readingMemoEdit(text, 99, DEFAULT_MEMO_MARKERS)).toMatchObject({ at: text.indexOf("三つ目") });
  });
});

describe("resumeIndexAt", () => {
  it("挿したあとの本文で、ずれた文の位置から続ける（付箋の行は読まない）", () => {
    const after = "一つ目の文。\n// 音読：ここで引っかかった\n二つ目の文。\n三つ目の文。";
    const plan = readingPlanFor(after, "本文/第1話.txt");
    const index = resumeIndexAt(plan, after.indexOf("二つ目"));
    expect(plan.sentences[index]!.speech).toBe("二つ目の文。");
  });

  it("その位置より後に文が無ければ頭から", () => {
    const plan = readingPlanFor("一つ目の文。", "本文/第1話.txt");
    expect(resumeIndexAt(plan, 999)).toBe(0);
  });
});
