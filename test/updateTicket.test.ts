import { describe, expect, it } from "vitest";
// @ts-expect-error 組み立ての道具（.mjs）。型は持たない
import { changelogSummary, makeTicket, releaseNotes } from "../scripts/updateTicket.mjs";
import { parseTicket } from "../src/platform/appUpdate";

const CHANGELOG = `# 変わったこと

## 0.1.139（2026-11-21）

- 話の一覧をたためるようにしました
- カーソルのちらつきを直しました

## 0.1.138（2026-11-20）

- 新しい版を確かめられるようにしました
`;

describe("更新の札 update.json を作る（Release に添える。引継ぎ書 155章）", () => {
  it("要約は CHANGELOG のその版の行（3行まで）", () => {
    expect(changelogSummary(CHANGELOG, "0.1.139")).toEqual(["話の一覧をたためるようにしました", "カーソルのちらつきを直しました"]);
    expect(changelogSummary(CHANGELOG, "0.1.138")).toEqual(["新しい版を確かめられるようにしました"]);
    expect(() => changelogSummary(CHANGELOG, "0.1.200")).toThrow(/0\.1\.200/);
  });

  it("札は共通の形で、アプリの照らしを通る", () => {
    const ticket = makeTicket({
      version: "0.1.139",
      date: "2026-11-21",
      summary: ["話の一覧をたためるようにしました"],
      apk: { name: "novel-ai-mobile-0.1.139.apk", sha256: "e".repeat(64), bytes: 4321 },
    });
    expect(ticket).toEqual({
      product: "novel-ai-mobile",
      version: "0.1.139",
      date: "2026-11-21",
      summary: ["話の一覧をたためるようにしました"],
      assets: [
        {
          platform: "android",
          name: "novel-ai-mobile-0.1.139.apk",
          url: "https://github.com/nonahisa/novel-ai-mobile/releases/download/v0.1.139/novel-ai-mobile-0.1.139.apk",
          sha256: "e".repeat(64),
          bytes: 4321,
        },
      ],
      minimumFrom: null,
    });
    expect(parseTicket(ticket)).toEqual(ticket);
  });

  it("Release ノートは要約と、末尾に札の SHA-256", () => {
    const notes = releaseNotes(["話の一覧をたためるようにしました"], "f".repeat(64));
    expect(notes).toBe(`- 話の一覧をたためるようにしました\n\nSHA-256：${"f".repeat(64)}\n`);
  });
});
