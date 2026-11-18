import { describe, expect, it } from "vitest";
import { checkEpisodeName, nextNameLike, suggestEpisodeName } from "./newEpisode";
import { parseEpisodeFileName } from "../shared";

const episodes = (...names: string[]) =>
  names.map((fileName) => {
    const p = parseEpisodeFileName(fileName);
    return { filePath: `/w/本文/${fileName}`, fileName, chapterStart: p.chapterStart, chapterEnd: p.chapterEnd ?? p.chapterStart } as never;
  });

describe("新しい話の名前（［…］→ 新しい話）", () => {
  it("いちばん新しい話の流儀で次の番号", () => {
    expect(nextNameLike("第2話 灯台.txt", 3)).toBe("第3話.txt");
    expect(nextNameLike("018.md", 19)).toBe("019.md");
    expect(nextNameLike("episode_0018_題.md", 19)).toBe("episode_0019.md");
    expect(nextNameLike(null, 1)).toBe("001.txt");
    expect(nextNameLike("プロローグ.txt", 1)).toBe("001.txt");
  });
  it("作品の話から案を作る（話数の最大 + 1）", () => {
    expect(suggestEpisodeName({ episodes: episodes("第1話 手紙.txt", "第2話 霧笛.txt") })).toBe("第3話.txt");
    expect(suggestEpisodeName({ episodes: [] })).toBe("001.txt");
  });
  it("創作メモ集は「無題」、SNS 記事は今日の日付", () => {
    expect(suggestEpisodeName({ episodes: episodes("無題.md"), format: "memo" })).toBe("無題2.md");
    expect(suggestEpisodeName({ episodes: [], format: "sns" }, new Date(2026, 10, 19))).toBe("2026-11-19.txt");
  });
  it("名前を確かめる", () => {
    expect(checkEpisodeName("  ", [])).toBe("ファイルの名前を入れてください");
    expect(checkEpisodeName("第3話?.txt", [])).toBe("ファイルの名前に使えない字が入っています");
    expect(checkEpisodeName("第3話", [])).toBe("名前の終わりは .txt か .md にしてください");
    expect(checkEpisodeName("第1話 手紙.txt", ["第1話 手紙.txt"])).toBe("同じ名前の話がもうあります");
    expect(checkEpisodeName("第3話.txt", ["第1話 手紙.txt"])).toBeUndefined();
  });
});
