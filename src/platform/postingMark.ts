import {
  POSTING_FILE,
  POSTING_SCHEMA_VERSION,
  collectedEpisodeStarts,
  containsConflictMarkers,
  detectJsonFileFormat,
  extractEpisodeParts,
  formatJsonForFile,
  isPosted,
  normalizeEpisodePath,
  parsePostingLedger,
  postingEpisodeKey,
  postingNotationTextHash,
  postingTitleHash,
  withPost,
  type PostingLedger,
  type PostingSiteId,
} from "../shared";
import { FileNotFoundError, joinStorePath, type FileStore } from "./fileStore";
import { ledgerShapeProblem } from "./ledgerShapeGate";
import { readWorkMemoMarkers } from "./memoMarkers";
import { readTextFile, writeTextFilePreservingFormat, type TextFileContent } from "./textFile";
import { readWorkLayout, scanWorkFolder } from "./workScan";
import { toStorePath } from "./paths";

/**
 * **「投稿しました」の印**（2026-11-28 作者の答え「付ける（ぶつかったら両方の印を残す）」。本体の設計書 6.68.2・
 * `features/postingKit.ts` の `withPost` と同じ記録）。［…］→［投稿しました］で、投稿の台帳（`設定/投稿状態.json`）の
 * `posts` に1件足す。
 *
 * **守り**（台帳はパソコンと同期するので、本体の `postingStore.ts` と同じ約束）：
 * - 台帳の JSON をそのまま読み、**`posts` だけ**を差し替えて書く。ほかの欄・この版が知らない欄・読み飛ばす行は1字も変えない
 *   （本体の型を通して書き直すと、新しい版の機械が書いた欄が消える）
 * - 壊れた台帳・この版の知らない新しい形の台帳は、直さずに止める
 * - 書く直前に読み直し、読んだときと違えば書かない（`writeTextFilePreservingFormat` のハッシュの照らし合わせ）
 * - 台帳が無い・投稿先が登録されていない作品では印を出さない（台帳は作らない。投稿先の登録はパソコンの投稿キットで）
 * - もうそのサイトへ出した話には付けない（同じ話を2本出す道を作らない。出し直しの記録はパソコンで）
 * - 合本（1ファイルに何話も）には付けない（ファイルまるごとの印は全話を投稿済みにする。どの話かを選ぶ画面はまだ無い）
 *
 * 本文の印（`bodyHash`）と題の印（`titleHash`）は本体と同じ部品で同じ材料から取る：題は走査の題（`workScan.ts` の
 * `subtitle`。本体の走査と同じ式）を `extractEpisodeParts` に渡したもの、本文は頭書きを外したもの、メモの印は作品の設定のもの。
 * 違う印を書くと、本体が直していない話に出し直しを促すので、材料がそろわないときは印を付けずに止める。
 */

export type PostingMarkRead =
  /** 台帳が無い・投稿先が無い。［投稿しました］を出さない */
  | { kind: "none" }
  /** 台帳か話の側の理由で付けられない（作者に見せる1行） */
  | { kind: "blocked"; message: string }
  | { kind: "ready"; sites: Array<{ site: PostingSiteId; posted: boolean }> };

export type PostingMarkResult = { ok: true; message: string } | { ok: false; message: string };

interface LoadedLedger {
  path: string;
  raw: Record<string, unknown>;
  ledger: PostingLedger;
  content: TextFileContent;
  bytes: Uint8Array;
}

type LedgerRead = { kind: "none" } | { kind: "blocked"; message: string } | { kind: "loaded"; loaded: LoadedLedger };

async function loadLedger(store: FileStore, workRoot: string): Promise<LedgerRead> {
  let path: string;
  try {
    path = joinStorePath((await readWorkLayout(store, workRoot)).settings, POSTING_FILE);
  } catch {
    return { kind: "blocked", message: "作品の設定が読めないので、投稿の印は付けられません" };
  }
  let bytes: Uint8Array;
  let content: TextFileContent;
  try {
    bytes = await store.readFile(path);
    content = await readTextFile(store, path);
  } catch (error) {
    if (error instanceof FileNotFoundError) return { kind: "none" };
    return { kind: "blocked", message: "投稿の台帳が読めないので、印は付けられません" };
  }
  const newer = ledgerShapeProblem("投稿状態", content.text, POSTING_SCHEMA_VERSION);
  if (newer) return { kind: "blocked", message: newer };
  let raw: unknown;
  let ledger: PostingLedger;
  try {
    raw = JSON.parse(content.text);
    ledger = parsePostingLedger(raw);
  } catch {
    return { kind: "blocked", message: "投稿の台帳が壊れているので、印は付けられません（パソコンで直してください）" };
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { kind: "blocked", message: "投稿の台帳の形が違うので、印は付けられません" };
  if (ledger.sites.length === 0) return { kind: "none" };
  return { kind: "loaded", loaded: { path, raw: raw as Record<string, unknown>, ledger, content, bytes } };
}

/** 作品フォルダーからの話の道（台帳の鍵。区切りは `/`） */
function relativeOf(workRoot: string, episodePath: string): string | undefined {
  if (!episodePath.startsWith(`${workRoot}/`)) return undefined;
  return normalizeEpisodePath(episodePath.slice(workRoot.length + 1));
}

/** 話の本文から、印を付けられるかを見る（付けられなければ理由） */
function episodeProblem(text: string): string | undefined {
  if (containsConflictMarkers(text)) return "競合の印が残っている話には、投稿の印を付けません";
  if (collectedEpisodeStarts(text).length > 0) return "何話かをまとめたファイルには、投稿の印をまだ付けられません（パソコンで付けてください）";
  return undefined;
}

export async function readPostingMark(store: FileStore, workRoot: string, episodePath: string): Promise<PostingMarkRead> {
  const relative = relativeOf(workRoot, episodePath);
  if (!relative) return { kind: "none" };
  const read = await loadLedger(store, workRoot);
  if (read.kind !== "loaded") return read;
  let text: string;
  try {
    text = (await readTextFile(store, episodePath)).text;
  } catch {
    return { kind: "blocked", message: "話が読めないので、投稿の印は付けられません" };
  }
  const problem = episodeProblem(text);
  if (problem) return { kind: "blocked", message: problem };
  const { ledger } = read.loaded;
  return { kind: "ready", sites: ledger.sites.map((entry) => ({ site: entry.site, posted: isPosted(ledger, relative, entry.site) })) };
}

export async function markPosted(input: {
  store: FileStore;
  workRoot: string;
  /** 話（置き場の中の場所）。保存を済ませてから呼ぶ（印は置き場の本文から取る） */
  episodePath: string;
  site: PostingSiteId;
  now?: Date;
  /** 書く直前に、その道をアプリが書いた控えへ（`touchedPaths.ts`。送り漏らさないように） */
  beforeWrite?: (path: string) => Promise<void>;
}): Promise<PostingMarkResult> {
  const { store, workRoot, episodePath, site } = input;
  const relative = relativeOf(workRoot, episodePath);
  if (!relative) return { ok: false, message: "この話は作品の中にありません" };
  const read = await loadLedger(store, workRoot);
  if (read.kind === "none") return { ok: false, message: "この作品には投稿先が登録されていません（パソコンの投稿キットで登録します）" };
  if (read.kind === "blocked") return { ok: false, message: read.message };
  const loaded = read.loaded;
  if (!loaded.ledger.sites.some((entry) => entry.site === site)) return { ok: false, message: "登録していないサイトには、印を付けません" };
  if (isPosted(loaded.ledger, relative, site)) return { ok: false, message: "この話は、もうこのサイトへ出した印があります" };

  // 印の材料（本体の postingKit と同じ：走査の題・頭書きを外した本文・作品のメモの印）
  let text: string;
  let subtitle: string | null;
  let markers;
  try {
    text = (await readTextFile(store, episodePath)).text;
    const scanned = await scanWorkFolder(store, workRoot);
    const episode = scanned.episodes.find((candidate) => toStorePath(candidate.filePath) === episodePath);
    if (!episode) return { ok: false, message: "話が作品の一覧に見つからないので、印を付けませんでした" };
    subtitle = episode.subtitle;
    markers = await readWorkMemoMarkers(store, workRoot);
  } catch {
    return { ok: false, message: "話か作品の設定が読めないので、印を付けませんでした" };
  }
  const problem = episodeProblem(text);
  if (problem) return { ok: false, message: problem };
  const parts = extractEpisodeParts(text, subtitle);
  if (!parts.body.trim()) return { ok: false, message: "本文が無い話には、印を付けません" };

  const recorded = withPost(
    loaded.ledger,
    relative,
    site,
    (input.now ?? new Date()).toISOString(),
    postingNotationTextHash(parts.subtitle, parts.body, markers),
    undefined,
    postingTitleHash(parts.subtitle)
  );
  const record = recorded.posts[recorded.posts.length - 1]!;
  const key = postingEpisodeKey(record);
  // 生の posts から、同じ話・同じサイトの記録だけを除いて足す（withPost と同じ決まり。ほかの記録は生のまま）
  const rawPosts = Array.isArray(loaded.raw.posts) ? (loaded.raw.posts as unknown[]) : [];
  const kept = rawPosts.filter((entry) => !(isRecord(entry) && entry.site === site && postingEpisodeKey(entry as never) === key));
  const next = { ...loaded.raw, posts: [...kept, record] };
  const textOut = formatJsonForFile(next, detectJsonFileFormat(loaded.bytes));
  await input.beforeWrite?.(loaded.path).catch(() => undefined);
  const written = await writeTextFilePreservingFormat(store, loaded.path, textOut, loaded.content, loaded.content.hash);
  if (!written.ok) {
    return {
      ok: false,
      message:
        written.reason === "modified_externally"
          ? "投稿の台帳が読んだあとで変わったので、印を付けませんでした。もう一度押してください"
          : "投稿の台帳に書けませんでした",
    };
  }
  return { ok: true, message: "投稿しましたの印を付けました" };
}

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

/** 並びを問わず、同じ JSON の値か */
function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((value, index) => sameJson(value, b[index]));
  }
  if (!isRecord(a) || !isRecord(b)) return false;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) if (!sameJson(a[key], b[key])) return false;
  return true;
}

function parseRaw(text: string): Record<string, unknown> | undefined {
  try {
    const value = JSON.parse(text) as unknown;
    if (!isRecord(value)) return undefined;
    parsePostingLedger(value);
    return value;
  } catch {
    return undefined;
  }
}

/**
 * **同期でぶつかった投稿の台帳を、両方の印を残して合わせる**（2026-11-28 作者の答え「ぶつかったら両方の印を残す」）。
 *
 * 合わせるのは、**こちらが祖先から変えたのが `posts` に印を足しただけ**のときだけ。結果は「あちらの台帳そのもの＋こちらが足した印」
 * （あちらの直し・印・知らない欄は消さない）。同じ話・同じサイトの印が両方にあれば、あちらの1件を残す（本体の `withPost` と同じく
 * 1件に保つ。あちらにはヘルパーが送り返した番号などが付いていることがある）。
 *
 * こちらが印のほかも変えた・前からある印を消したり書き換えたりした（話の名前替えの付け替えなど）・どれかが壊れている、のどれかなら
 * undefined（合わせず、いつもの［こちら］［あちら］で作者が選ぶ）。書き方（字下げ・改行）はあちらの台帳に合わせる。
 */
export function mergePostingLedgerTexts(baseText: string, oursText: string, theirsText: string): string | undefined {
  const base = parseRaw(baseText);
  const ours = parseRaw(oursText);
  const theirs = parseRaw(theirsText);
  if (!base || !ours || !theirs) return undefined;
  if (!sameJson({ ...base, posts: undefined }, { ...ours, posts: undefined })) return undefined;
  const basePosts = Array.isArray(base.posts) ? (base.posts as unknown[]) : [];
  const oursPosts = Array.isArray(ours.posts) ? (ours.posts as unknown[]) : [];
  if (!Array.isArray(theirs.posts)) return undefined;
  const theirsPosts = theirs.posts as unknown[];
  // こちらの印は「祖先の印をそのまま持ち、後ろに足しただけ」か
  if (oursPosts.length < basePosts.length || !basePosts.every((entry, index) => sameJson(entry, oursPosts[index]))) return undefined;
  const added = oursPosts.slice(basePosts.length);
  if (added.length === 0) return undefined;
  if (!added.every((entry) => isRecord(entry) && typeof entry.site === "string")) return undefined;
  const keyOf = (entry: unknown) => `${(entry as { site: string }).site}\u0000${postingEpisodeKey(entry as never)}`;
  const known = new Set(theirsPosts.filter(isRecord).map(keyOf));
  const merged = { ...theirs, posts: [...theirsPosts, ...added.filter((entry) => !known.has(keyOf(entry)))] };
  try {
    parsePostingLedger(merged);
  } catch {
    return undefined;
  }
  return formatJsonForFile(merged, detectJsonFileFormat(new TextEncoder().encode(theirsText)));
}
