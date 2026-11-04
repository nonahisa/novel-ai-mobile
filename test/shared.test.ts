import { describe, expect, test } from "vitest";
import { parsePostingLedger } from "novel-ai-assistant/src/models/posting";
import { postingTextHash } from "novel-ai-assistant/src/core/postingBodyHash";

describe("本体の部品を取り込めるか（段0の試作）", () => {
  test("投稿の台帳を読んで、新しい欄（revisions・bodyHash）を落とさない", () => {
    const hash = postingTextHash("第1話", "本文です。");
    const ledger = parsePostingLedger({
      version: 1,
      posts: [{ site: "kakuyomu", episodePath: "原稿/第1話.txt", postedAt: "2026-11-05T09:00:00+09:00", bodyHash: hash }],
      revisions: [{ site: "kakuyomu", episodePath: "原稿/第1話.txt", revisedAt: "2026-11-05T10:00:00+09:00", bodyHash: hash }],
    });
    expect(ledger.posts[0]?.bodyHash).toBe(hash);
    expect(ledger.revisions?.[0]?.bodyHash).toBe(hash);
  });
});
