import { sha256Hex } from "./fontDownload";

/**
 * **更新の仕組み：新しい版を確かめる**（2026-11-20 作者「全製品共通ですが、アップデートの仕組みを作ってください」。
 * 共通の決まりは統合（novel-ai-assistant）の `docs/更新の仕組み_共通.md`。モバイル版の作りは引継ぎ書 154章）。
 *
 * - 新しい版の出どころは、このリポジトリの GitHub Release の最新だけ。Release に添えた「更新の札」`update.json` を読む
 * - 札の SHA-256 は、Release ノートの末尾の `SHA-256：…` と照らす。合わなければ使わない
 * - 送るのは GitHub への GET だけ（サインインの合言葉も付けない）。作品・原稿・設定・機械の名前は送らない
 * - 自動で確かめるのは、起動したときと前に出たときで、1日に1回まで。設定で切れる
 * - 落ちたら黙る（次の確かめまで）。エラー文から原因を当てない
 *
 * ここは画面に触らない（試験のため）。知らせと設定の画面は `src/app/updateScreen.ts`
 */

export const PRODUCT = "novel-ai-mobile";
export const UPDATE_REPO = "nonahisa/novel-ai-mobile";
/** 最新の Release（下書き・試しの版は入らない） */
export const UPDATE_API_LATEST = `https://api.github.com/repos/${UPDATE_REPO}/releases/latest`;
/** 札と APK はこの下の物だけ使う */
export const RELEASE_DOWNLOAD_PREFIX = `https://github.com/${UPDATE_REPO}/releases/download/`;
/** 札の名前（Release に添える） */
export const TICKET_NAME = "update.json";

/**
 * **自動の確かめの既定はオン**（2026-11-20 作者「最初からオン」。共通の決まり 4章）。［ほか］→［設定］→［更新］で切れる。
 * パソコンの試しのブラウザ（web）では、`shell.ts` が既定をオフにして渡す（画面の試験が本物の GitHub へ行かないように）
 */
export const UPDATE_CHECK_DEFAULT = true;
export const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

export interface UpdateAsset {
  platform: string;
  name: string;
  url: string;
  sha256: string;
  bytes: number;
}
export interface UpdateTicket {
  product: string;
  version: string;
  date: string;
  summary: string[];
  assets: UpdateAsset[];
  minimumFrom: string | null;
}

const VERSION = /^\d+(\.\d+)*$/;

/** 版を数で比べる（a が新しければ正）。足りない桁は 0 とみなす */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** 自動で確かめてよいか（前の確かめから1日たった・まだ確かめていない・時計が戻った） */
export function dueForCheck(now: number, lastCheck: number | undefined): boolean {
  if (lastCheck === undefined) return true;
  if (now < lastCheck) return true;
  return now - lastCheck >= CHECK_INTERVAL_MS;
}

/** 札の形を照らす。合わなければ undefined（使わない） */
export function parseTicket(raw: unknown): UpdateTicket | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const t = raw as Record<string, unknown>;
  if (t.product !== PRODUCT) return undefined;
  if (typeof t.version !== "string" || !VERSION.test(t.version)) return undefined;
  if (typeof t.date !== "string") return undefined;
  if (!Array.isArray(t.summary) || !t.summary.every((line) => typeof line === "string")) return undefined;
  if (!Array.isArray(t.assets)) return undefined;
  const assets: UpdateAsset[] = [];
  for (const a of t.assets as unknown[]) {
    if (typeof a !== "object" || a === null) return undefined;
    const x = a as Record<string, unknown>;
    if (typeof x.platform !== "string" || typeof x.name !== "string" || typeof x.url !== "string") return undefined;
    if (!x.url.startsWith(RELEASE_DOWNLOAD_PREFIX)) return undefined;
    if (typeof x.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(x.sha256)) return undefined;
    if (typeof x.bytes !== "number" || !Number.isFinite(x.bytes) || x.bytes < 0) return undefined;
    assets.push({ platform: x.platform, name: x.name, url: x.url, sha256: x.sha256, bytes: x.bytes });
  }
  const minimumFrom = t.minimumFrom ?? null;
  if (minimumFrom !== null && (typeof minimumFrom !== "string" || !VERSION.test(minimumFrom))) return undefined;
  return { product: t.product, version: t.version, date: t.date, summary: t.summary as string[], assets, minimumFrom };
}

export type Notice =
  | { kind: "none" }
  | {
      kind: "new";
      version: string;
      summary: string[];
      /** Android で入れ替えに使う APK（iOS は知らせだけなので無い） */
      asset?: UpdateAsset;
      /** 今の版から直には上げられない（`minimumFrom` より古い） */
      tooOld: boolean;
    };

/** 知らせるか。今の版より新しく、飛ばした版でもなければ知らせる */
export function decideNotice(ticket: UpdateTicket, current: string, skipped: string | undefined, platform: string): Notice {
  if (compareVersions(ticket.version, current) <= 0) return { kind: "none" };
  if (skipped !== undefined && compareVersions(ticket.version, skipped) <= 0) return { kind: "none" };
  const asset = platform === "android" ? ticket.assets.find((a) => a.platform === "android") : undefined;
  const tooOld = ticket.minimumFrom !== null && compareVersions(current, ticket.minimumFrom) < 0;
  return { kind: "new", version: ticket.version, summary: ticket.summary, ...(asset ? { asset } : {}), tooOld };
}

/* ---------- 設定（端末の中だけ。同期しない） ---------- */

export const UPDATE_AUTO_KEY = "novelai.update.auto";
export const UPDATE_LAST_CHECK_KEY = "novelai.update.lastCheck";
export const UPDATE_SKIPPED_KEY = "novelai.update.skipped";

export interface UpdateSettings {
  auto: boolean;
  lastCheck: number | undefined;
  skipped: string | undefined;
}

/** `fallback`：作者がまだ選んでいないときの自動の確かめ（既定は {@link UPDATE_CHECK_DEFAULT}） */
export function readUpdateSettings(storage: Pick<Storage, "getItem"> | undefined, fallback: boolean = UPDATE_CHECK_DEFAULT): UpdateSettings {
  try {
    const auto = storage?.getItem(UPDATE_AUTO_KEY);
    const last = Number(storage?.getItem(UPDATE_LAST_CHECK_KEY));
    const skipped = storage?.getItem(UPDATE_SKIPPED_KEY) ?? undefined;
    return {
      auto: auto === "on" ? true : auto === "off" ? false : fallback,
      lastCheck: Number.isFinite(last) && last > 0 ? last : undefined,
      skipped: skipped && VERSION.test(skipped) ? skipped : undefined,
    };
  } catch {
    return { auto: fallback, lastCheck: undefined, skipped: undefined };
  }
}

export function writeUpdateSettings(storage: Pick<Storage, "setItem" | "removeItem"> | undefined, settings: UpdateSettings): void {
  try {
    storage?.setItem(UPDATE_AUTO_KEY, settings.auto ? "on" : "off");
    if (settings.lastCheck === undefined) storage?.removeItem(UPDATE_LAST_CHECK_KEY);
    else storage?.setItem(UPDATE_LAST_CHECK_KEY, String(settings.lastCheck));
    if (settings.skipped === undefined) storage?.removeItem(UPDATE_SKIPPED_KEY);
    else storage?.setItem(UPDATE_SKIPPED_KEY, settings.skipped);
  } catch {
    // 端末の置き場に書けなくても、次の起動でまた確かめるだけ
  }
}

/* ---------- 取りに行く ---------- */

export interface UpdateFetchDeps {
  /** GitHub の API を GET して JSON を返す（合言葉は付けない） */
  getJson(url: string): Promise<unknown>;
  /** 札を GET して中身の文字を返す（Release の置き場は CORS を許さないので、端末では端末の側の通信） */
  getText(url: string): Promise<string>;
}

/** Release ノートの末尾の `SHA-256：…`（全角・半角のコロン） */
export function releaseNoteSha(body: string): string | undefined {
  const all = [...body.matchAll(/SHA-256\s*[：:]\s*([0-9a-fA-F]{64})/g)];
  return all.length > 0 ? all[all.length - 1][1].toLowerCase() : undefined;
}

/** 最新の Release の札を取ってきて照らす。無い・合わない・落ちたら undefined（黙る） */
export async function fetchLatestTicket(deps: UpdateFetchDeps): Promise<UpdateTicket | undefined> {
  try {
    const release = (await deps.getJson(UPDATE_API_LATEST)) as { body?: unknown; assets?: unknown };
    const assets = Array.isArray(release?.assets) ? (release.assets as { name?: unknown; browser_download_url?: unknown }[]) : [];
    const entry = assets.find((a) => a.name === TICKET_NAME);
    const url = typeof entry?.browser_download_url === "string" ? entry.browser_download_url : undefined;
    if (!url || !url.startsWith(RELEASE_DOWNLOAD_PREFIX)) return undefined;
    const want = releaseNoteSha(typeof release.body === "string" ? release.body : "");
    if (!want) return undefined;
    const text = await deps.getText(url);
    const got = await sha256Hex(new TextEncoder().encode(text));
    if (got !== want) return undefined;
    return parseTicket(JSON.parse(text));
  } catch {
    return undefined;
  }
}

/**
 * 製品の道の取りに行き方。API は WebView の fetch（CORS を許す。合言葉もクッキーも付けない）。
 * 札は Release の置き場にあり、CORS を許さない（2026-11-20 curl で確かめた）ので、端末では端末の側の通信で取る
 */
export function defaultUpdateFetch(isNative: boolean, nativeGetText: (url: string) => Promise<string>): UpdateFetchDeps {
  return {
    getJson: async (url) => {
      const response = await fetch(url, { credentials: "omit", headers: { Accept: "application/vnd.github+json" } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    },
    getText: async (url) => {
      if (isNative) return nativeGetText(url);
      const response = await fetch(url, { credentials: "omit" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.text();
    },
  };
}
