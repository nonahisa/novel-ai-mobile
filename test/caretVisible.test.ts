import { describe, expect, test } from "vitest";
import { caretScrollDelta, revealDelta } from "../src/app/caretVisible";

/**
 * キーボードが出ても、カーソルのある所を見える位置へ送る量（2026-11-07 Mac の iOS シミュレーター：
 * 縦書きの欄がキーボードの下に隠れた）。見える範囲は visualViewport（キーボードの分だけ縮む）。
 */

const band = { top: 0, height: 400 }; // キーボードが出て、上の 400 だけが見えている

describe("カーソルを見える所へ送る量", () => {
  test("キーボードの下に隠れていれば、その分だけ下へ送る（下の余白 48 を空ける）", () => {
    expect(caretScrollDelta({ top: 600, bottom: 620 }, band)).toBe(620 - (400 - 48));
  });
  test("上のバーの下に隠れていれば、上へ戻す（上の余白 64 を空ける）", () => {
    expect(caretScrollDelta({ top: 10, bottom: 30 }, band)).toBe(10 - 64);
  });
  test("見えていれば送らない", () => {
    expect(caretScrollDelta({ top: 200, bottom: 220 }, band)).toBe(0);
  });
  test("ページが拡大・ずらされていても、見える範囲の上の端から測る（iOS の visualViewport.offsetTop）", () => {
    expect(caretScrollDelta({ top: 400, bottom: 420 }, { top: 250, height: 400 })).toBe(0);
    expect(caretScrollDelta({ top: 260, bottom: 280 }, { top: 250, height: 400 })).toBe(260 - (250 + 64));
  });
});

describe("欄の頭をなるべく見せたまま送る（2026-11-08 AQUOS wish3：欄を押すと欄の上側が帯の裏へ送られた）", () => {
  const band = { top: 0, height: 368 };
  const margins = { top: 85, bottom: 48 };
  test("カーソルが見えていれば送らない", () => {
    expect(revealDelta({ top: 150, bottom: 170 }, band, margins, 100)).toBe(0);
  });
  test("カーソルを見せるために送るときも、カーソルが見える限り、欄の頭を帯の下に残す", () => {
    // 欄の頭 100、カーソル 400〜420：カーソルだけなら 420-320=100 送り、欄の頭が 0 になる。
    // カーソルが見えたままなら戻せるだけ戻す → 送りは 100 のまま（カーソルの下に余りが無い）
    expect(revealDelta({ top: 400, bottom: 420 }, band, margins, 100)).toBe(100);
    // カーソル 300〜310：送らなくて見える。欄の頭も 100 のまま
    expect(revealDelta({ top: 300, bottom: 310 }, band, margins, 100)).toBe(0);
    // 欄の頭 100、カーソル 60〜80（帯の裏）：カーソルを見せるため 25 上へ戻す（欄の頭も 125 で見える）
    expect(revealDelta({ top: 60, bottom: 80 }, band, margins, 100)).toBe(-25);
  });
  test("もう欄の頭が帯の裏にあれば、カーソルが見える分だけ下へ戻す", () => {
    // 欄の頭 -71、カーソル 64〜66（帯の下の端より上）→ カーソルを見せつつ欄の頭を見せる
    const d = revealDelta({ top: 64, bottom: 66 }, band, margins, -71);
    expect(d).toBeLessThan(0);
    expect(66 - d).toBeLessThanOrEqual(368 - 48);
  });
  test("欄の頭を渡さなければ、前と同じ", () => {
    expect(revealDelta({ top: 400, bottom: 420 }, band, margins)).toBe(caretScrollDelta({ top: 400, bottom: 420 }, band, margins));
  });
});
