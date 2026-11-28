import { describe, expect, it } from "vitest";
import { findWebVoice, webVoiceChoices } from "../src/platform/speech";

/**
 * ［ほか］→［設定］→［読み上げ］の声の並び（iOS・ブラウザ）。2026-11-29 Mac が iPad mini 6（0.2.4）で見つけた：
 * 「Kyoko」が2つ並び、見分けがつかない（iOS は同じ名前の声を標準・高品質で別に持つ）。名前でなく voiceURI で見分ける
 */
const voice = (name: string, voiceURI: string, lang = "ja-JP") => ({ name, voiceURI, lang });

describe("webVoiceChoices", () => {
  it("日本語の声だけを、voiceURI を鍵にして並べる", () => {
    expect(webVoiceChoices([voice("Kyoko", "uri-a"), voice("Samantha", "uri-en", "en-US")])).toEqual([{ id: "uri-a", label: "Kyoko" }]);
  });

  it("同じ名前の声は、品質を見出しに添えて見分ける", () => {
    const choices = webVoiceChoices([
      voice("Kyoko", "com.apple.voice.compact.ja-JP.Kyoko"),
      voice("Kyoko", "com.apple.voice.enhanced.ja-JP.Kyoko"),
      voice("Kyoko", "com.apple.voice.premium.ja-JP.Kyoko"),
    ]);
    expect(choices.map((c) => c.label)).toEqual(["Kyoko（標準）", "Kyoko（高品質）", "Kyoko（最高品質）"]);
    expect(new Set(choices.map((c) => c.id)).size).toBe(3);
  });

  it("品質が読めない同じ名前は、番号で見分ける", () => {
    expect(webVoiceChoices([voice("声", "x1"), voice("声", "x2")]).map((c) => c.label)).toEqual(["声（1）", "声（2）"]);
  });

  // 2026-11-29 Mac が iPad mini 6（0.2.5）で見つけた：「Kyoko（標準）」が2つ並んだ（どちらの voiceURI にも compact があった見込み）
  it("品質を添えても同じ見出しになる声は、品質に番号を添える", () => {
    const choices = webVoiceChoices([
      voice("Kyoko", "com.apple.voice.compact.ja-JP.Kyoko"),
      voice("Kyoko", "com.apple.ttsbundle.Kyoko-compact"),
    ]);
    expect(choices.map((c) => c.label)).toEqual(["Kyoko（標準・1）", "Kyoko（標準・2）"]);
    expect(new Set(choices.map((c) => c.id)).size).toBe(2);
  });

  it("名前も voiceURI も同じ声は、1つだけ並べる（同じ声が2回届いたとき）", () => {
    const same = voice("Kyoko", "com.apple.voice.compact.ja-JP.Kyoko");
    expect(webVoiceChoices([same, { ...same }])).toEqual([{ id: "com.apple.voice.compact.ja-JP.Kyoko", label: "Kyoko" }]);
  });

  it("voiceURI が空なら名前を鍵にする", () => {
    expect(webVoiceChoices([voice("Kyoko", "")])).toEqual([{ id: "Kyoko", label: "Kyoko" }]);
  });
});

describe("findWebVoice", () => {
  const all = [voice("Kyoko", "com.apple.voice.compact.ja-JP.Kyoko"), voice("Kyoko", "com.apple.voice.enhanced.ja-JP.Kyoko")];

  it("voiceURI で引く", () => {
    expect(findWebVoice(all, "com.apple.voice.enhanced.ja-JP.Kyoko")?.voiceURI).toBe("com.apple.voice.enhanced.ja-JP.Kyoko");
  });

  it("0.2.4 で名前だけを覚えた人は、その名前の最初の声", () => {
    expect(findWebVoice(all, "Kyoko")?.voiceURI).toBe("com.apple.voice.compact.ja-JP.Kyoko");
  });

  it("無ければ undefined", () => {
    expect(findWebVoice(all, "無い声")).toBeUndefined();
  });
});
