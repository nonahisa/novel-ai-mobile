import { describe, expect, test } from "vitest";
import { encodeLastEpisode, parseLastEpisode, readLastEpisode, rememberLastEpisode, renderLastEpisodeCard, LAST_EPISODE_KEY } from "../src/app/lastEpisode";

/** 最後に開いた話（`src/app/lastEpisode.ts`。設計書 4.3）。作品は作り物（`_確認用`）だけ */

const ENTRY = { root: "灯台守_確認用", path: "灯台守_確認用/本文/第1話 手紙.txt" };

describe("最後に開いた話", () => {
  test("覚えて読み戻せる。読めない・形の違う・作品の外を指すものは覚えていないのと同じ", () => {
    expect(parseLastEpisode(encodeLastEpisode(ENTRY))).toEqual(ENTRY);
    for (const raw of [null, "", "{", "[]", "1", JSON.stringify({ root: "灯台守_確認用" }), JSON.stringify({ root: "灯台守_確認用", path: "ほか_確認用/本文/第1話.txt" })]) {
      expect(parseLastEpisode(raw)).toBeUndefined();
    }
  });

  test("端末の覚え場所が使えなくても投げない", () => {
    const broken = {
      getItem: () => {
        throw new Error("使えない");
      },
      setItem: () => {
        throw new Error("使えない");
      },
    };
    expect(readLastEpisode(broken)).toBeUndefined();
    expect(() => rememberLastEpisode(broken, ENTRY)).not.toThrow();
    const map = new Map<string, string>();
    const storage = { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v) };
    rememberLastEpisode(storage, ENTRY);
    expect(map.has(LAST_EPISODE_KEY)).toBe(true);
    expect(readLastEpisode(storage)).toEqual(ENTRY);
  });

  test("札は話の名前と作品。字はそのまま出す。覚えていなければ何も置かない", () => {
    expect(renderLastEpisodeCard(undefined)).toBe("");
    const html = renderLastEpisodeCard({ root: "猫<b>_確認用", path: "猫<b>_確認用/本文/第1話 <i>夜.txt" });
    expect(html).toContain(`data-episode="猫&lt;b&gt;_確認用/本文/第1話 &lt;i&gt;夜.txt" data-root="猫&lt;b&gt;_確認用"`);
    expect(html).toContain(`<span class="work-title">第1話 &lt;i&gt;夜</span>`);
  });
});
