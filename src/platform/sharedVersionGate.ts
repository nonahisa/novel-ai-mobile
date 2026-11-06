/**
 * **版が古い間は、台帳を書かない**（2026-11-06 作者の裁定。引継ぎ書 3章）。
 *
 * 作品フォルダーの `設定/` は GitHub で同期するので、本体とモバイル版が同じ台帳を
 * 読み書きする。本体の版が上がったのにモバイル版が古い部品のままだと、
 * 本体で増えた欄を知らずに書き戻して、同期で消してしまう（引継ぎ書 1章）。
 * そこで、本体の最新のタグがモバイル版の取り込んだ版（`SHARED_VERSION`）より
 * 新しい間は、台帳を書く機能を止める。読むのは止めない。
 *
 * ## 最新の版の知り方
 *
 * 本体は台帳に自分の版を書かない（`schemaVersion` は台帳の形の版で、本体の版では
 * ない）ので、GitHub の本体のリポジトリのタグを見る（`api.github.com` は CORS を
 * 許すので、WebView の `fetch` で読める。2026-11-06 に確かめた）。
 * 見た答えは端末の設定に覚えておき、つながらないときはそれを使う。
 *
 * **一度も確かめられていない間も止める。** 作品を取ってくる（clone）にも
 * 送る（push）にもネットが要るので、そのついでに確かめれば足りる。
 * 作者のパソコンの本体が最新のタグより古いこともあるが、それでも止める
 * （「いつも本体と同じ版」の決まり。止まったら、モバイル版を出し直す合図）。
 *
 * ## 使い方（台帳を書く部品を載せるとき）
 *
 * 台帳を書く口の頭で `gate.check()` を見て、`allowed` でなければ書かずに
 * `message` を出す。同期の前後で `gate.refresh()` を呼ぶ。
 */

/** 本体のリポジトリ（タグを見る先） */
export const BODY_TAGS_URL = "https://api.github.com/repos/nonahisa/novel-ai-assistant/tags?per_page=100";

/** 端末の設定に覚える鍵 */
export const LATEST_BODY_VERSION_KEY = "novelai.mobile.latestBodyVersion";

/** 覚えておく形 */
export interface LatestBodyVersion {
  /** 本体の最新のタグの版（`0.127.0` の形。`v` は付けない） */
  version: string;
  /** 確かめた時刻（ISO 8601） */
  checkedAt: string;
}

/** `0.127.0`・`v0.127.0` を数の並びにする。読めなければ undefined */
export function parseVersion(text: string): [number, number, number] | undefined {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(text.trim());
  if (!match) return undefined;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** a が b より新しければ正、同じなら 0、古ければ負 */
export function compareVersions(a: [number, number, number], b: [number, number, number]): number {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

/**
 * タグの名前の並びから、いちばん新しい版を選ぶ（GitHub は版の順に並べて返すとは限らない）。
 * `v1.2.3` の形でないタグ（`v1.2.3-beta` など）は見ない。
 */
export function latestVersionOf(tagNames: readonly string[]): string | undefined {
  let best: [number, number, number] | undefined;
  for (const name of tagNames) {
    const parsed = parseVersion(name);
    if (parsed && (!best || compareVersions(parsed, best) > 0)) best = parsed;
  }
  return best?.join(".");
}

/** 端末の設定のうち、ここで使うところだけ（`DeviceSettings` がこの形） */
export interface VersionStore {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): Promise<void>;
}

export type GateAnswer =
  | { allowed: true }
  | { allowed: false; reason: "unchecked" | "stale"; message: string; latest?: string };

/** 台帳を書いてよいかの関所 */
export class LedgerWriteGate {
  constructor(
    /** モバイル版が取り込んだ本体の版（`SHARED_VERSION`） */
    private readonly sharedVersion: string,
    private readonly store: VersionStore,
    private readonly fetcher: (url: string) => Promise<Response> = (url) =>
      globalThis.fetch(url, { headers: { accept: "application/vnd.github+json" } }),
    private readonly now: () => Date = () => new Date()
  ) {}

  /** 覚えている最新の版 */
  latest(): LatestBodyVersion | undefined {
    const value = this.store.get<LatestBodyVersion>(LATEST_BODY_VERSION_KEY);
    return value && typeof value.version === "string" && parseVersion(value.version) ? value : undefined;
  }

  /**
   * GitHub で本体の最新のタグを確かめ、覚え直す。
   * つながらない・読めないときは覚えているものを変えず、その理由を返す（投げない）。
   */
  async refresh(): Promise<{ ok: true; latest: LatestBodyVersion } | { ok: false; detail: string }> {
    let names: string[];
    try {
      const response = await this.fetcher(BODY_TAGS_URL);
      if (!response.ok) return { ok: false, detail: `GitHub が ${response.status} を返しました` };
      const body = (await response.json()) as unknown;
      if (!Array.isArray(body)) return { ok: false, detail: "GitHub の答えが読めませんでした" };
      names = body.map((tag) => (tag as { name?: unknown })?.name).filter((n): n is string => typeof n === "string");
    } catch (error) {
      return { ok: false, detail: error instanceof Error ? error.message : String(error) };
    }
    const version = latestVersionOf(names);
    if (!version) return { ok: false, detail: "本体のタグが見つかりませんでした" };
    const latest: LatestBodyVersion = { version, checkedAt: this.now().toISOString() };
    await this.store.update(LATEST_BODY_VERSION_KEY, latest);
    return { ok: true, latest };
  }

  /** いま台帳を書いてよいか（ネットは見ない。覚えている版で決める） */
  check(): GateAnswer {
    const latest = this.latest();
    if (!latest) {
      return {
        allowed: false,
        reason: "unchecked",
        message:
          "本体の最新の版をまだ確かめていないので、設定の台帳は書きません。ネットにつないで同期すると確かめます。",
      };
    }
    const shared = parseVersion(this.sharedVersion);
    const newest = parseVersion(latest.version);
    if (!shared || !newest || compareVersions(newest, shared) > 0) {
      return {
        allowed: false,
        reason: "stale",
        latest: latest.version,
        message: `本体が ${latest.version} に上がっています（モバイル版は ${this.sharedVersion} の部品）。本体で増えた欄を消さないよう、モバイル版を新しくするまで設定の台帳は書きません。本文は書けます。`,
      };
    }
    return { allowed: true };
  }
}
