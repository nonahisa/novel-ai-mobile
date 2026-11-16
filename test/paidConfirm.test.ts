import { describe, expect, test } from "vitest";
import { paidConfirmHtml } from "../src/app/paidConfirm";

/** 有料の AI へ送る前の確認の窓（`src/app/paidConfirm.ts`。引継ぎ書 72章）。文言は本体の paidUsageNotice のまま */

const visible = (html: string) => html.replace(/<li>/g, "\n").replace(/<[^>]+>/g, "");

describe("有料の AI へ送る前の確認", () => {
  test("題は「〈操作〉を実行しますか」。本文の3行と［詳しく］の行は本体の文言", () => {
    const html = paidConfirmHtml({
      actionLabel: "誤字脱字",
      providerId: "claude",
      providerName: "Claude（クラウド・有料）",
      model: "claude-x",
      notice: { sends: "本文 約4,321字（1話）", calls: 2 },
    })!;
    const text = visible(html);
    expect(text).toContain("誤字脱字を実行しますか");
    expect(text).toContain("Claude（有料）で送ります");
    expect(text).toContain("送るもの：本文 約4,321字（1話）");
    expect(text).toContain("料金：AIを 2 回呼びます。使った量だけかかります");
    expect(text).toContain("使うモデル：claude-x");
    expect(text).toContain("実際の金額はモデル・実使用量・各社の現行料金によって変わります。");
  });

  test("無料枠のある AI は「無料枠あり・超えると有料」。本文を送らない機能は「（本文は送りません）」。手元の AI は窓を出さない", () => {
    const gemini = visible(
      paidConfirmHtml({ actionLabel: "あらすじ", providerId: "gemini", providerName: "Gemini（クラウド・無料枠あり）", model: "g", notice: { sends: "プロット", bodyNotSent: true } })!
    );
    expect(gemini).toContain("Gemini（無料枠あり・超えると有料）で送ります");
    expect(gemini).toContain("送るもの：プロット（本文は送りません）");
    expect(gemini).toContain("料金：送るたびに、使った量だけかかります");
    for (const local of ["ollama", "lmstudio"]) {
      expect(paidConfirmHtml({ actionLabel: "推敲", providerId: local, providerName: "Ollama（ローカル）", model: "m", notice: { sends: "本文" } })).toBeUndefined();
    }
  });
});
