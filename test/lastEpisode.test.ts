import { describe, expect, test } from "vitest";
import { encodeLastEpisode, parseLastEpisode, parseRecentEpisodes, pushRecentEpisode, readLastEpisode, readRecentEpisodes, rememberLastEpisode, renderLastEpisodeCard, renderWriteLead, LAST_EPISODE_KEY } from "../src/app/lastEpisode";

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

describe("最近開いた話（2026-11-18 作者「最後に開いた話と、最近開いた話を5つほど」）", () => {
  const ep = (n: number) => ({ root: "works/灯台守_確認用", path: `works/灯台守_確認用/本文/第${n}話.txt` });
  test("開くたびに頭に足し、同じ話は前の所から外す。最後の話＋5つまで", () => {
    let list = [] as ReturnType<typeof pushRecentEpisode>;
    for (const n of [1, 2, 3, 4, 5, 6, 7, 3]) list = pushRecentEpisode(list, ep(n));
    expect(list.map((e) => e.path.match(/第(\d)話/)![1])).toEqual(["3", "7", "6", "5", "4", "2"]);
  });

  test("覚えて読み戻す。壊れた値は空", () => {
    const map = new Map<string, string>();
    const storage = { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v) };
    rememberLastEpisode(storage, ep(1));
    rememberLastEpisode(storage, ep(2));
    expect(readRecentEpisodes(storage).map((e) => e.path)).toEqual([ep(2).path, ep(1).path]);
    expect(parseRecentEpisodes("{")).toEqual([]);
    expect(parseRecentEpisodes(JSON.stringify([{ root: "a", path: "b/x.txt" }, ep(4)]))).toEqual([ep(4)]);
  });

  test("［書く］の頭：最後に開いた話の札、その下に最近の話（最後の話は重ねない）", () => {
    const html = renderWriteLead(ep(3), [ep(3), ep(2), ep(1)]);
    expect(html.match(/class="work-card"/g)).toHaveLength(1);
    expect([...html.matchAll(/<span class="name">([^<]+)<\/span>/g)].map((m) => m[1])).toEqual(["第2話", "第1話"]);
    expect(html).toContain("<h2>最近の話</h2>");
    expect(renderWriteLead(ep(3), [ep(3)])).not.toContain("最近の話");
  });
});
