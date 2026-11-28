import { normalizeEpisodePath, parsePostingLedger, POSTING_FILE, unpostedSites, type PostingSiteId } from "../shared";
import { joinStorePath, type FileStore } from "./fileStore";
import { toStorePath } from "./paths";
import { readTextFile } from "./textFile";
import { readWorkLayout, type ScannedWork } from "./workScan";

/**
 * **まだ投稿していない話**（2026-11-29 作者の答え「両方に出す」：作品一覧の札に数、話の一覧の行に印）。
 *
 * 見分け方は本体の作品一覧の「未投稿」（`views/workTree.ts` の `unpostedSitesFor`）と同じ：投稿の台帳（`設定/投稿状態.json`）に
 * 登録したサイトのうち、その話をまだ出していないサイト（`unpostedSites`）。登録したサイトが無い作品では出さない（投稿キットを
 * 使わない作者の一覧に「未投稿」が全話ぶん並ばないように）。
 *
 * - 競合の印のある話は数えない（本体も印の代わりに「未解決の競合」を出す）
 * - **読むだけ**。台帳が無い・読めない・壊れているときは何も出さない（一覧は止めない。理由は［投稿しました］で出る）
 *
 * 返すのは、登録したサイトの数と、未投稿のサイトが1つ以上ある話（置き場の場所 → まだのサイト。並びは話の並び）
 */
export interface UnpostedEpisodes {
  registered: number;
  episodes: Map<string, PostingSiteId[]>;
}

export async function readUnpostedEpisodes(store: FileStore, work: ScannedWork): Promise<UnpostedEpisodes> {
  const result: UnpostedEpisodes = { registered: 0, episodes: new Map() };
  let ledger;
  try {
    const settings = (await readWorkLayout(store, work.root)).settings;
    ledger = parsePostingLedger(JSON.parse((await readTextFile(store, joinStorePath(settings, POSTING_FILE))).text));
  } catch {
    return result;
  }
  if (ledger.sites.length === 0) return result;
  result.registered = ledger.sites.length;
  for (const episode of work.episodes) {
    if (episode.hasConflictMarkers) continue;
    const storePath = toStorePath(episode.filePath);
    if (!storePath?.startsWith(`${work.root}/`)) continue;
    const sites = unpostedSites(ledger, normalizeEpisodePath(storePath.slice(work.root.length + 1)));
    if (sites.length > 0) result.episodes.set(storePath, sites);
  }
  return result;
}

