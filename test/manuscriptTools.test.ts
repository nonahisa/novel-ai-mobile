import { describe, expect, test } from "vitest";
import { TOOL_STRIP, applyRuby, insertText, rubyPlan, toggleEmphasis, wrapBrackets } from "../src/app/manuscriptTools";

/** 原稿エディターの道具帯の中身（`src/app/manuscriptTools.ts`。設計書 5.6） */

describe("道具帯", () => {
  test("並びは設計書の案のとおり（向きの押し口は上のバー）", () => {
    expect(TOOL_STRIP.map((t) => t.label)).toEqual(["取り消し", "やり直し", "ルビ", "傍点", "「」", "――", "……"]);
  });

  test("――・…… は2字を1押しで入れ、選んだ字は替える", () => {
    expect(insertText("灯台へ。", 3, 3, "――")).toEqual({ text: "灯台へ――。", selStart: 5, selEnd: 5 });
    expect(insertText("灯台へ。", 0, 2, "……")).toEqual({ text: "……へ。", selStart: 2, selEnd: 2 });
  });

  test("「」は選んでいなければ中へ、選んでいれば括ってうしろへ", () => {
    expect(wrapBrackets("姉は言った。", 5, 5)).toEqual({ text: "姉は言った「」。", selStart: 6, selEnd: 6 });
    expect(wrapBrackets("姉は来た", 0, 1)).toEqual({ text: "「姉」は来た", selStart: 3, selEnd: 3 });
  });

  test("ルビ：選んでいなければカーソルの前の漢字に振る。既にあるルビは読みを直す・空で外す", () => {
    const plan = rubyPlan("灯台守が", 3, 3);
    expect(plan).toMatchObject({ kind: "new", base: "灯台守" });
    if (plan.kind === "none") throw new Error();
    const added = applyRuby("灯台守が", plan, "とうだいもり");
    expect(added).toEqual({ ok: true, edit: { text: "{灯台守|とうだいもり}が", selStart: 12, selEnd: 12 } });
    const again = rubyPlan("{灯台守|とうだいもり}が", 12, 12);
    expect(again.kind).toBe("edit");
    if (again.kind === "none") throw new Error();
    expect(applyRuby("{灯台守|とうだいもり}が", again, "")).toEqual({ ok: true, edit: { text: "灯台守が", selStart: 3, selEnd: 3 } });
    expect(rubyPlan("ひらがな", 4, 4).kind).toBe("none");
    expect(applyRuby("灯台守が", plan, "とう|")).toMatchObject({ ok: false });
    expect(applyRuby("灯台守が", plan, "")).toMatchObject({ ok: false });
  });

  test("傍点：選んだ字に付け、傍点の所で押すと外す。選んでいなければ理由", () => {
    expect(toggleEmphasis("ここで待つ", 3, 5)).toEqual({ ok: true, edit: { text: "ここで{{待つ}}", selStart: 9, selEnd: 9 } });
    expect(toggleEmphasis("ここで{{待つ}}", 9, 9)).toEqual({ ok: true, edit: { text: "ここで待つ", selStart: 5, selEnd: 5 } });
    expect(toggleEmphasis("ここで待つ", 2, 2)).toMatchObject({ ok: false });
  });
});
