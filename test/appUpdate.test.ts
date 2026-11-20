import { describe, expect, it } from "vitest";
import {
  compareVersions,
  decideNotice,
  dueForCheck,
  fetchLatestTicket,
  parseTicket,
  readUpdateSettings,
  RELEASE_DOWNLOAD_PREFIX,
  UPDATE_API_LATEST,
  UPDATE_CHECK_DEFAULT,
  writeUpdateSettings,
  type UpdateTicket,
} from "../src/platform/appUpdate";
import { sha256Hex } from "../src/platform/fontDownload";

const SHA = "a".repeat(64);
const ticket = (over: Partial<UpdateTicket> = {}): UpdateTicket => ({
  product: "novel-ai-mobile",
  version: "0.1.140",
  date: "2026-11-21",
  summary: ["話の一覧をたためるようにしました"],
  assets: [{ platform: "android", name: "novel-ai-mobile-0.1.140.apk", url: `${RELEASE_DOWNLOAD_PREFIX}v0.1.140/novel-ai-mobile-0.1.140.apk`, sha256: SHA, bytes: 123 }],
  minimumFrom: null,
  ...over,
});

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k) => map.get(k) ?? null,
    key: (i) => [...map.keys()][i] ?? null,
    removeItem: (k) => void map.delete(k),
    setItem: (k, v) => void map.set(k, String(v)),
  };
}

describe("更新の仕組み：新しい版の確かめ（統合 docs/更新の仕組み_共通.md。引継ぎ書 154章）", () => {
  it("版は数で比べる（0.1.99 より 0.1.137 が新しい）", () => {
    expect(compareVersions("0.1.137", "0.1.99")).toBeGreaterThan(0);
    expect(compareVersions("0.1.99", "0.1.137")).toBeLessThan(0);
    expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
    expect(compareVersions("1.0", "1.0.0")).toBe(0);
  });

  it("確かめるのは1日に1回まで（まだ一度も確かめていなければ確かめる）", () => {
    const day = 24 * 60 * 60 * 1000;
    expect(dueForCheck(1_000_000, undefined)).toBe(true);
    expect(dueForCheck(day * 10, day * 10 - day + 1)).toBe(false);
    expect(dueForCheck(day * 10, day * 9)).toBe(true);
    // 時計が戻っていたら確かめる（いつまでも黙らない）
    expect(dueForCheck(day, day * 3)).toBe(true);
  });

  it("札は形を照らす：製品の名前・版・SHA-256・置き場（このリポジトリの Release だけ）", () => {
    expect(parseTicket(ticket())).toEqual(ticket());
    expect(parseTicket({ ...ticket(), product: "rittoku-ime" })).toBeUndefined();
    expect(parseTicket({ ...ticket(), version: "v0.1.140" })).toBeUndefined();
    expect(parseTicket({ ...ticket(), summary: "一行" })).toBeUndefined();
    const elsewhere = ticket({ assets: [{ ...ticket().assets[0], url: "https://example.com/novel-ai-mobile.apk" }] });
    expect(parseTicket(elsewhere)).toBeUndefined();
    const badSha = ticket({ assets: [{ ...ticket().assets[0], sha256: "abc" }] });
    expect(parseTicket(badSha)).toBeUndefined();
    expect(parseTicket("not json")).toBeUndefined();
  });

  it("新しい版があれば知らせる。同じ・古い版、飛ばした版は知らせない", () => {
    expect(decideNotice(ticket(), "0.1.137", undefined, "android")).toMatchObject({ kind: "new", version: "0.1.140", asset: { platform: "android" } });
    expect(decideNotice(ticket(), "0.1.140", undefined, "android")).toEqual({ kind: "none" });
    expect(decideNotice(ticket(), "0.1.141", undefined, "android")).toEqual({ kind: "none" });
    expect(decideNotice(ticket(), "0.1.137", "0.1.140", "android")).toEqual({ kind: "none" });
    // 飛ばしたのより新しい版は知らせる
    expect(decideNotice(ticket({ version: "0.1.141" }), "0.1.137", "0.1.140", "android")).toMatchObject({ kind: "new", version: "0.1.141" });
  });

  it("iOS は知らせだけ（入れ替えの置き場は渡さない）。直に上げられない古い版なら、そう言う", () => {
    const ios = decideNotice(ticket(), "0.1.137", undefined, "ios");
    expect(ios).toMatchObject({ kind: "new", version: "0.1.140" });
    expect(ios.kind === "new" && ios.asset).toBeUndefined();
    const old = decideNotice(ticket({ minimumFrom: "0.1.120" }), "0.1.110", undefined, "android");
    expect(old).toMatchObject({ kind: "new", tooOld: true });
  });

  it("設定：自動の確かめの既定はオン（2026-11-20 作者「最初からオン」）。切る・飛ばす版・最後に確かめた時を覚える", () => {
    const storage = memoryStorage();
    expect(UPDATE_CHECK_DEFAULT).toBe(true);
    expect(readUpdateSettings(storage)).toEqual({ auto: true, lastCheck: undefined, skipped: undefined });
    // パソコンの試しのブラウザ（web）は既定を渡してオフにする（試験が本物の GitHub へ行かないように）
    expect(readUpdateSettings(storage, false).auto).toBe(false);
    writeUpdateSettings(storage, { auto: false, lastCheck: 42, skipped: "0.1.140" });
    expect(readUpdateSettings(storage)).toEqual({ auto: false, lastCheck: 42, skipped: "0.1.140" });
    writeUpdateSettings(storage, { auto: true, lastCheck: 43, skipped: undefined });
    expect(readUpdateSettings(storage)).toEqual({ auto: true, lastCheck: 43, skipped: undefined });
  });

  it("取りに行く：最新の Release の札を読み、Release ノートの末尾の SHA-256 と札が合えば返す。合わない・無い・落ちたら黙る", async () => {
    const text = JSON.stringify(ticket());
    const sha = await sha256Hex(new TextEncoder().encode(text));
    const asked: string[] = [];
    const release = (body: string) => ({
      tag_name: "v0.1.140",
      body,
      assets: [{ name: "update.json", browser_download_url: `${RELEASE_DOWNLOAD_PREFIX}v0.1.140/update.json` }],
    });
    const deps = (body: string, ticketText = text) => ({
      getJson: async (url: string) => {
        asked.push(url);
        return release(body);
      },
      getText: async (url: string) => {
        asked.push(url);
        return ticketText;
      },
    });
    expect(await fetchLatestTicket(deps(`中身\n\nSHA-256：${sha}`))).toEqual(ticket());
    expect(asked).toEqual([UPDATE_API_LATEST, `${RELEASE_DOWNLOAD_PREFIX}v0.1.140/update.json`]);
    expect(await fetchLatestTicket(deps(`SHA-256：${"b".repeat(64)}`))).toBeUndefined();
    expect(await fetchLatestTicket(deps("SHA-256 の行が無い"))).toBeUndefined();
    expect(await fetchLatestTicket(deps(`SHA-256：${sha}`, "{壊れた"))).toBeUndefined();
    expect(
      await fetchLatestTicket({
        getJson: async () => {
          throw new Error("通信が落ちた");
        },
        getText: async () => "",
      })
    ).toBeUndefined();
  });
});
