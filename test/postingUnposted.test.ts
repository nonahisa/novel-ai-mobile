import { describe, expect, it } from "vitest";
import { MemoryFileStore } from "../src/platform/memoryFileStore";
import { readUnpostedEpisodes } from "../src/platform/postingUnposted";
import { scanWorkFolder } from "../src/platform/workScan";
import { unpostedEpisodeLabel, unpostedWorkFlag } from "../src/app/workListView";

/**
 * まだ投稿していない話（2026-11-29 作者の答え「両方に出す」：作品一覧の札に数、話の一覧の行に印）。見分け方は本体の作品一覧の
 * 「未投稿」と同じ（`unpostedSites`：登録したサイトのうち、まだ出していないサイト。登録したサイトが無ければ出さない）。
 * 読むだけ。作品は作り物（`_確認用`）だけ
 */
const enc = (text: string) => new TextEncoder().encode(text);
const ROOT = "灯台守_確認用";
const LEDGER = `${ROOT}/設定/投稿状態.json`;
const EP1 = `${ROOT}/本文/第1話 手紙.txt`;
const EP2 = `${ROOT}/本文/第2話 灯台.txt`;
const EP3 = `${ROOT}/本文/第3話 霧笛.txt`;
const KAKUYOMU = { site: "kakuyomu", newEpisodeUrl: "https://kakuyomu.jp/my/works/1177354054/episodes/new" };
const NAROU = { site: "narou", newEpisodeUrl: "https://syosetu.com/usernovelmanage/ziwaiinput/ncode/123/" };
const ledgerOf = (value: Record<string, unknown>) => JSON.stringify({ schemaVersion: "1", sites: [KAKUYOMU, NAROU], posts: [], rankings: [], ...value });
const post = (file: string, site: string) => ({ episodePath: `本文/${file}`, site, postedAt: "2026-11-01T00:00:00.000Z" });

async function setup(ledger?: string) {
  const store = new MemoryFileStore();
  store.putExternally(`${ROOT}/.aiwriter/config.json`, enc(JSON.stringify({ workTitle: "灯台守の手紙_確認用" })));
  store.putExternally(EP1, enc("姉から手紙が届いた。"));
  store.putExternally(EP2, enc("階段をのぼる。"));
  store.putExternally(EP3, enc("<<<<<<< ours\n霧\n=======\n雨\n>>>>>>> theirs\n"));
  if (ledger !== undefined) store.putExternally(LEDGER, enc(ledger));
  return { store, work: await scanWorkFolder(store, ROOT) };
}

describe("まだ投稿していない話を読む", () => {
  it("登録したサイトのうち、まだ出していないサイトを話ごとに返す（競合の話は数えない）", async () => {
    const { store, work } = await setup(ledgerOf({ posts: [post("第1話 手紙.txt", "kakuyomu"), post("第1話 手紙.txt", "narou"), post("第2話 灯台.txt", "narou")] }));
    const unposted = await readUnpostedEpisodes(store, work);
    expect(unposted.registered).toBe(2);
    expect([...unposted.episodes.entries()]).toEqual([[EP2, ["kakuyomu"]]]);
  });

  it("台帳が無い・投稿先が無い・壊れているときは何も出さない（台帳には触らない）", async () => {
    expect((await readUnpostedEpisodes((await setup()).store, (await setup()).work)).episodes.size).toBe(0);
    const empty = await setup(ledgerOf({ sites: [] }));
    expect((await readUnpostedEpisodes(empty.store, empty.work)).episodes.size).toBe(0);
    const broken = await setup("{ こわれた");
    expect((await readUnpostedEpisodes(broken.store, broken.work)).episodes.size).toBe(0);
    expect(new TextDecoder().decode(await broken.store.readFile(LEDGER))).toBe("{ こわれた");
  });
});

describe("未投稿の札と印の文", () => {
  it("作品一覧の札は話の数。0話なら出さない", () => {
    expect(unpostedWorkFlag(3)).toEqual({ text: "未投稿：3話", tone: "warn" });
    expect(unpostedWorkFlag(0)).toBeUndefined();
  });

  it("話の行の印：登録したサイトの全部が未投稿なら「未投稿」、一部ならまだのサイトの名前", () => {
    expect(unpostedEpisodeLabel(["kakuyomu", "narou"], 2)).toBe("未投稿");
    expect(unpostedEpisodeLabel(["kakuyomu"], 1)).toBe("未投稿");
    expect(unpostedEpisodeLabel(["kakuyomu"], 2)).toBe("未投稿：カクヨム");
  });
});
