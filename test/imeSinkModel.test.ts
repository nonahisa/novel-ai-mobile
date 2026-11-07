import { describe, expect, test } from "vitest";
import {
  SINK_SENTINEL,
  commitSinkValue,
  initialSinkState,
  pageEditFor,
  readSinkValue,
  renderSinkHtml,
  sinkDisplayState,
} from "../src/app/imeSinkModel";

/**
 * B の「見えない受け口」の形（iOS 向け。作者の答え 2026-11-07「iPhone にも足す」）。
 * 変換中の字を本文のカーソルの位置に挟んで全体に1本の線を引く・確定で本文へ移す・消す改行はページが受け持つ、を見張る。
 * 線が右に出るか・受け口の位置が合うかは実機（iOS シミュレーター）で見る。
 */

describe("変換中の字を描く", () => {
  test("カーソルの位置に挟み、全体に1本の線（区切りは1つ）", () => {
    const s = { ...initialSinkState("朝の駅"), selection: 2, composing: true, compText: "きょう" };
    expect(sinkDisplayState(s)).toEqual({
      text: "朝のきょう駅",
      selection: 5,
      composing: true,
      formats: [{ start: 2, end: 5, style: "solid", thickness: "thin" }],
    });
    const html = renderSinkHtml(s);
    expect(html.match(/class="comp"/g)).toHaveLength(3);
    // カーソルの印は変換中の字のうしろ
    expect(html).toContain('<span data-i="4" data-n="1" class="comp">う</span><span class="caret"');
  });

  test("変換していないとき・変換中の字が空のときは線を引かない", () => {
    expect(renderSinkHtml(initialSinkState("あい"))).not.toContain("comp");
    expect(renderSinkHtml({ ...initialSinkState("あい"), composing: true, compText: "" })).not.toContain("comp");
  });
});

describe("確定して本文へ移す", () => {
  test("カーソルの位置へ入れ、カーソルを進め、変換中を終える", () => {
    const s = { ...initialSinkState("朝の駅"), selection: 2, composing: true, compText: "きょう" };
    expect(commitSinkValue(s, "今日")).toEqual({ text: "朝の今日駅", selection: 4, composing: false, compText: "" });
  });
  test("受け口が空なら本文は変えず、変換中だけを終える（変換を取り消したとき）", () => {
    const s = { ...initialSinkState("あ"), composing: true, compText: "い" };
    expect(commitSinkValue(s, "")).toEqual({ text: "あ", selection: 1, composing: false, compText: "" });
  });
});

describe("消す・改行はページが受け持つ", () => {
  test("後ろへ消すは、受け口の見えない字が消えたことで読む（iOS は空の受け口で ⌫ の知らせを出さない）", () => {
    expect(readSinkValue("")).toEqual({ backspace: true, inserted: "" });
    expect(readSinkValue(SINK_SENTINEL)).toEqual({ backspace: false, inserted: "" });
  });
  test("見えない字のうしろの字は確定した字。本文に見えない字は入らない", () => {
    expect(readSinkValue(`${SINK_SENTINEL}今日`)).toEqual({ backspace: false, inserted: "今日" });
    // 見えない字が消えて字が入った（選んで打ち替えたなど）：消す1回と字
    expect(readSinkValue("a")).toEqual({ backspace: true, inserted: "a" });
  });
  test("改行と前へ消すは beforeinput で受ける。後ろへ消すは beforeinput では扱わない", () => {
    expect(pageEditFor("insertLineBreak", SINK_SENTINEL, false)).toBe("newline");
    expect(pageEditFor("insertParagraph", SINK_SENTINEL, false)).toBe("newline");
    expect(pageEditFor("deleteContentForward", SINK_SENTINEL, false)).toBe("delete");
    expect(pageEditFor("deleteContentBackward", SINK_SENTINEL, false)).toBeUndefined();
  });
  test("変換中・受け口に字があるときは、受け口（IME）に任せる", () => {
    expect(pageEditFor("insertLineBreak", SINK_SENTINEL, true)).toBeUndefined();
    expect(pageEditFor("deleteContentForward", `${SINK_SENTINEL}き`, false)).toBeUndefined();
    expect(pageEditFor("insertText", SINK_SENTINEL, false)).toBeUndefined();
  });
});
