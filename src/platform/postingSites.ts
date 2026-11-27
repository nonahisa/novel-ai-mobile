import { POSTING_FILE, parsePostingLedger, postingPageUrl, siteProfile, type PostingLedger, type PostingSiteId } from "../shared";
import { joinStorePath, type FileStore } from "./fileStore";
import { readTextFile } from "./textFile";
import { readWorkLayout } from "./workScan";

/**
 * **投稿の台帳（`設定/投稿状態.json`）から、書き出しに要る2つだけを読む**（本体の設計書 6.68.2・6.68.6）。
 *
 * - 登録した投稿先：［…］→ 書き出しの貼り付け先の並びで先に出す（本体の `registeredPostingSites` と同じ）
 * - そのサイトの投稿ページ：写したあとに［◯◯の投稿ページを開く］を出す（本体の `postingPageUrlFor` と同じ。
 *   決め方は本体の `postingPageUrl`。台帳の URL を開く直前にそのサイトのドメインか確かめ、無ければ形の確かな
 *   サイト〔カクヨム・アルファポリス〕だけ作品ID から組み立てる。推測の URL は開かない）
 *
 * **読むだけで、台帳には書かない。** 「投稿しました」の記録は、同期で両側が書いたときの扱いなどを決めてから。
 * 台帳が無い・読めない・壊れているときも止めない（本体と同じ。無いのは並びの手がかりと釦1つで、写しはできる）
 */
export interface PostingSitesRead {
  registered: PostingSiteId[];
  /** 開ける投稿ページ。サイトの無い書き出し先（別記法・HTML）や、開ける URL が無ければ undefined */
  pageUrl: (site: PostingSiteId | undefined) => string | undefined;
}

const NONE: PostingSitesRead = { registered: [], pageUrl: () => undefined };

export async function readPostingSites(store: FileStore, workRoot: string): Promise<PostingSitesRead> {
  let ledger: PostingLedger;
  try {
    const settings = (await readWorkLayout(store, workRoot)).settings;
    const content = await readTextFile(store, joinStorePath(settings, POSTING_FILE));
    ledger = parsePostingLedger(JSON.parse(content.text));
  } catch {
    return NONE;
  }
  return {
    registered: ledger.sites.map((entry) => entry.site),
    pageUrl: (site) =>
      site ? postingPageUrl(site, ledger.sites.find((entry) => entry.site === site)?.newEpisodeUrl, siteProfile(ledger, site)) : undefined,
  };
}
