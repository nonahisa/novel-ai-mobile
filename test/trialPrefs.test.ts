import { describe, expect, test } from "vitest";
import { parseTrialPrefs } from "../src/app/tategakiDraft";

describe("試しの画面の選び方を覚える（2026-11-07 Mac：入り直すと A に戻った）", () => {
  test("覚えた向き・A／B・受け口で開く", () => {
    const raw = JSON.stringify({ orientation: "horizontal", mode: "B", sinkKind: "sink" });
    expect(parseTrialPrefs(raw, true)).toEqual({ orientation: "horizontal", mode: "B", sinkKind: "sink" });
  });

  test("C（組んで書く）も覚える（2026-11-13）", () => {
    expect(parseTrialPrefs(JSON.stringify({ orientation: "vertical", mode: "C", sinkKind: "ec" }), true).mode).toBe("C");
  });

  test("何も覚えていない・壊れているなら、初めの形（縦書き・A）", () => {
    expect(parseTrialPrefs(null, true)).toEqual({ orientation: "vertical", mode: "A", sinkKind: "ec" });
    expect(parseTrialPrefs("{壊れた", true)).toEqual({ orientation: "vertical", mode: "A", sinkKind: "ec" });
    expect(parseTrialPrefs(JSON.stringify({ mode: "Z", orientation: 3 }), true)).toEqual({ orientation: "vertical", mode: "A", sinkKind: "ec" });
  });

  test("EditContext の無い端末（iOS）では、覚えていても見えない受け口にする", () => {
    const raw = JSON.stringify({ orientation: "vertical", mode: "B", sinkKind: "ec" });
    expect(parseTrialPrefs(raw, false)).toEqual({ orientation: "vertical", mode: "B", sinkKind: "sink" });
    expect(parseTrialPrefs(null, false).sinkKind).toBe("sink");
  });
});
