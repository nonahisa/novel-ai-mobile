import { describe, expect, it } from "vitest";
import { ALOUD_RATE_KEY, ALOUD_VOICE_KEY, parseAloudRate, readAloudPrefs, renderAloudSettings, writeAloudRate, writeAloudVoice } from "./aloudSettings";

// 2026-11-29 作者の答え「［ほか］→［設定］に置く（選んだものは覚えておく）」：読み上げの速さと声（本体の読み上げの列と同じ選び）
function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
    clear: () => map.clear(),
    key: () => null,
    get length() {
      return map.size;
    },
  };
}

describe("読み上げの速さと声を覚える", () => {
  it("何も覚えていなければ速さ1・端末の決まりの声", () => {
    expect(readAloudPrefs(memoryStorage())).toEqual({ rate: 1, voice: "" });
  });

  it("選んだ速さと声を覚えて読む", () => {
    const storage = memoryStorage();
    writeAloudRate(storage, 1.5);
    writeAloudVoice(storage, "声B");
    expect(readAloudPrefs(storage)).toEqual({ rate: 1.5, voice: "声B" });
    writeAloudVoice(storage, "");
    expect(storage.getItem(ALOUD_VOICE_KEY)).toBeNull();
  });

  it("速さは本体と同じ8段のいちばん近いものにそろえる（読めなければ1）", () => {
    expect(parseAloudRate("1.2")).toBe(1.15);
    expect(parseAloudRate("9")).toBe(2);
    expect(parseAloudRate("0.1")).toBe(0.5);
    expect(parseAloudRate("こわれた")).toBe(1);
    expect(parseAloudRate(null)).toBe(1);
    const storage = memoryStorage();
    storage.setItem(ALOUD_RATE_KEY, "abc");
    expect(readAloudPrefs(storage).rate).toBe(1);
  });

  it("覚えられない置き場でも投げない", () => {
    const broken = { getItem: () => { throw new Error("x"); }, setItem: () => { throw new Error("x"); }, removeItem: () => { throw new Error("x"); } };
    expect(readAloudPrefs(broken)).toEqual({ rate: 1, voice: "" });
    expect(() => writeAloudRate(broken, 2)).not.toThrow();
    expect(() => writeAloudVoice(broken, "a")).not.toThrow();
  });
});

describe("renderAloudSettings", () => {
  it("覚えた声がこの端末に無ければ、端末の決まりを選んだ形で出し、そう書く", () => {
    const html = renderAloudSettings({ rate: 1, voice: "無い声" }, [{ id: "声A", label: "声A" }]);
    expect(html).toContain('data-aloud-voice="" aria-pressed="true"');
    expect(html).toContain("前に選んだ声がこの端末に見つかりません");
  });

  it("声の名前は字のまま出す（HTML として読まない）", () => {
    const html = renderAloudSettings({ rate: 1, voice: "" }, [{ id: "<b>", label: "<b>" }]);
    expect(html).not.toContain("<b>");
  });
});
