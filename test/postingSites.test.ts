import { describe, expect, it } from "vitest";
import { MemoryFileStore } from "../src/platform/memoryFileStore";
import { readPostingSites } from "../src/platform/postingSites";

/**
 * ［…］→ 書き出しのあとに、そのサイトの投稿ページを開く（本体の設計書 6.68.6。台帳は読むだけ）。
 * 作品は作り物（`_確認用`）だけ
 */
const enc = (text: string) => new TextEncoder().encode(text);
const ROOT = "灯台守_確認用";
const LEDGER = `${ROOT}/設定/投稿状態.json`;

async function storeWith(ledger?: string): Promise<MemoryFileStore> {
  const store = new MemoryFileStore();
  store.putExternally(`${ROOT}/.aiwriter/config.json`, enc(JSON.stringify({ workTitle: "灯台守の手紙_確認用" })));
  if (ledger !== undefined) store.putExternally(LEDGER, enc(ledger));
  return store;
}

const ledgerOf = (value: Record<string, unknown>) => JSON.stringify({ schemaVersion: "1", sites: [], posts: [], ...value });

describe("投稿の台帳から、貼り付け先の並びと投稿ページを引く", () => {
  it("台帳が無ければ、登録は空・ページは開かない", async () => {
    const sites = await readPostingSites(await storeWith(), ROOT);
    expect(sites.registered).toEqual([]);
    expect(sites.pageUrl("kakuyomu")).toBeUndefined();
  });

  it("台帳の投稿ページの URL を使い、登録したサイトを返す", async () => {
    const store = await storeWith(
      ledgerOf({ sites: [{ site: "narou", newEpisodeUrl: "https://syosetu.com/usernovelmanage/ziwaiinput/ncode/123/" }, { site: "kakuyomu", newEpisodeUrl: "https://kakuyomu.jp/my/works/1177354054/episodes/new" }] })
    );
    const sites = await readPostingSites(store, ROOT);
    expect(sites.registered).toEqual(["narou", "kakuyomu"]);
    expect(sites.pageUrl("kakuyomu")).toBe("https://kakuyomu.jp/my/works/1177354054/episodes/new");
    expect(sites.pageUrl("narou")).toBe("https://syosetu.com/usernovelmanage/ziwaiinput/ncode/123/");
    // 記法だけの書き出し先（別記法・HTML）にはサイトが無い
    expect(sites.pageUrl(undefined)).toBeUndefined();
  });

  it("そのサイトのドメインでない URL・javascript: は開かない（推測もしない）", async () => {
    const store = await storeWith(
      ledgerOf({ sites: [{ site: "kakuyomu", newEpisodeUrl: "javascript:alert(1)" }, { site: "note", newEpisodeUrl: "https://example.com/new" }] })
    );
    const sites = await readPostingSites(store, ROOT);
    expect(sites.pageUrl("kakuyomu")).toBeUndefined();
    expect(sites.pageUrl("note")).toBeUndefined();
  });

  it("URL が無くても、作品情報の作品ID から形の確かなサイト（カクヨム）だけ組み立てる", async () => {
    const store = await storeWith(ledgerOf({ siteProfiles: [{ site: "kakuyomu", workId: "1177354054" }, { site: "narou", workId: "n1234ab" }] }));
    const sites = await readPostingSites(store, ROOT);
    expect(sites.pageUrl("kakuyomu")).toBe("https://kakuyomu.jp/my/works/1177354054/episodes/new");
    expect(sites.pageUrl("narou")).toBeUndefined();
  });

  it("台帳が壊れていても止めない（並びは既定・ページは開かない）", async () => {
    const sites = await readPostingSites(await storeWith("{ 壊れた"), ROOT);
    expect(sites.registered).toEqual([]);
    expect(sites.pageUrl("kakuyomu")).toBeUndefined();
  });
});
