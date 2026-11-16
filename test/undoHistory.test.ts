import { describe, expect, test } from "vitest";
import { MAX_STEPS, MERGE_MS, UndoHistory, diffStep } from "../src/app/undoHistory";

/** 取り消し・やり直しの手の積み方（設計書 5.5。`src/app/undoHistory.ts`） */

describe("変わった1か所", () => {
  test("前と後の違う所だけを取り出す", () => {
    expect(diffStep("吾輩は猫である", "吾輩は犬である")).toEqual({ start: 3, removed: "猫", inserted: "犬" });
    expect(diffStep("abc", "abXc")).toEqual({ start: 2, removed: "", inserted: "X" });
    expect(diffStep("同じ", "同じ")).toBeUndefined();
  });

  test("同じ字が続く所でも、元に戻せる形で取り出す", () => {
    const diff = diffStep("ああ", "あああ")!;
    expect("ああ".slice(0, diff.start) + diff.inserted + "ああ".slice(diff.start + diff.removed.length)).toBe("あああ");
  });
});

describe("取り消し・やり直し", () => {
  test("1手戻し、もう一度当てる。カーソルは変わった字のすぐ後", () => {
    const history = new UndoHistory();
    history.record("吾輩は猫", "吾輩は猫である", "other", 0);
    expect(history.undo("吾輩は猫である")).toEqual({ text: "吾輩は猫", caret: 4 });
    expect(history.canUndo()).toBe(false);
    expect(history.redo("吾輩は猫")).toEqual({ text: "吾輩は猫である", caret: 7 });
    expect(history.canRedo()).toBe(false);
  });

  test("続けて打った字は1手にまとめる", () => {
    const history = new UndoHistory();
    history.record("", "わ", "type", 0);
    history.record("わ", "わが", "type", 100);
    history.record("わが", "わがは", "type", 200);
    expect(history.undo("わがは")).toEqual({ text: "", caret: 0 });
    expect(history.canUndo()).toBe(false);
  });

  test("変換で、打ったばかりの読みを漢字に替えた手は、読みを打った手にまとめる（取り消すと読みも残らない）", () => {
    // 2026-11-17 左の線の欄の e2e：［取り消し］で「とうだい」が残った
    const history = new UndoHistory();
    history.record("姉。", "姉。と", "type", 0);
    history.record("姉。と", "姉。とう", "type", 100);
    history.record("姉。とう", "姉。とうだい", "type", 200);
    // 候補を選ぶのに時間がかかっても
    history.record("姉。とうだい", "姉。灯台", "type", 200 + MERGE_MS * 3);
    expect(history.undo("姉。灯台")).toEqual({ text: "姉。", caret: 2 });
    expect(history.canUndo()).toBe(false);
    expect(history.redo("姉。")?.text).toBe("姉。灯台");
  });

  test("打った字の外まで替える手は、まとめない", () => {
    const history = new UndoHistory();
    history.record("姉。", "姉。と", "type", 0);
    history.record("姉。と", "姉、灯", "type", 100);
    expect(history.undo("姉、灯")?.text).toBe("姉。と");
  });

  test(`間が ${MERGE_MS} ミリ秒あいたら別の手`, () => {
    const history = new UndoHistory();
    history.record("", "わ", "type", 0);
    history.record("わ", "わが", "type", MERGE_MS);
    expect(history.undo("わが")?.text).toBe("わ");
  });

  test("続けて ⌫ で消した字も1手にまとめる", () => {
    const history = new UndoHistory();
    history.record("吾輩は猫", "吾輩は", "type", 0);
    history.record("吾輩は", "吾輩", "type", 100);
    expect(history.undo("吾輩")).toEqual({ text: "吾輩は猫", caret: 4 });
  });

  test("改行・ルビ・傍点は、前の打った字とまとめない", () => {
    const history = new UndoHistory();
    history.record("", "猫", "type", 0);
    history.record("猫", "{猫|ねこ}", "other", 10);
    expect(history.undo("{猫|ねこ}")?.text).toBe("猫");
    expect(history.undo("猫")?.text).toBe("");
  });

  test("改行を含む字はまとめない", () => {
    const history = new UndoHistory();
    history.record("", "一", "type", 0);
    history.record("一", "一\n", "type", 10);
    expect(history.undo("一\n")?.text).toBe("一");
  });

  test("ルビの塊は記法の字のまま戻す（戻した本文はいつも記法として正しい）", () => {
    const history = new UndoHistory();
    history.record("{吾輩|わがはい}は猫", "は猫", "other", 0);
    expect(history.undo("は猫")).toEqual({ text: "{吾輩|わがはい}は猫", caret: 9 });
  });

  test("取り消したあとに新しく打つと、やり直しの手は捨てる", () => {
    const history = new UndoHistory();
    history.record("", "猫", "other", 0);
    history.undo("猫");
    expect(history.canRedo()).toBe(true);
    history.record("", "犬", "other", 10);
    expect(history.canRedo()).toBe(false);
  });

  test("手と本文が合わなければ戻さず、手を捨てる", () => {
    const history = new UndoHistory();
    history.record("", "猫", "other", 0);
    expect(history.undo("犬")).toBeUndefined();
    expect(history.canUndo()).toBe(false);
  });

  test(`手は ${MAX_STEPS} まで持つ`, () => {
    const history = new UndoHistory();
    let text = "";
    for (let i = 0; i < MAX_STEPS + 10; i++) {
      history.record(text, `${text}\n`, "other", i);
      text += "\n";
    }
    let count = 0;
    while (history.canUndo()) {
      text = history.undo(text)!.text;
      count++;
    }
    expect(count).toBe(MAX_STEPS);
    expect(text).toBe("\n".repeat(10));
  });
});
