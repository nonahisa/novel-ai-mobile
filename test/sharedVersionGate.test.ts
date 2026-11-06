import { describe, expect, test } from "vitest";
import {
  BODY_TAGS_URL,
  LATEST_BODY_VERSION_KEY,
  LedgerWriteGate,
  latestVersionOf,
  type VersionStore,
} from "../src/platform/sharedVersionGate";

/**
 * 版が古い間は、台帳を書かない（2026-11-06 作者の裁定）。
 * 本体の最新のタグと、モバイル版の取り込んだ版を比べる関所。
 */

class MemoryStore implements VersionStore {
  readonly values = new Map<string, unknown>();
  get<T>(key: string): T | undefined {
    return this.values.get(key) as T | undefined;
  }
  async update(key: string, value: unknown): Promise<void> {
    this.values.set(key, value);
  }
}

const tags = (...names: string[]) => async (url: string) => {
  expect(url).toBe(BODY_TAGS_URL);
  return new Response(JSON.stringify(names.map((name) => ({ name }))), { status: 200 });
};
const fixedNow = () => new Date("2026-11-06T12:00:00Z");

describe("いちばん新しいタグを選ぶ", () => {
  test("並び順によらず、版の数で比べる（0.127.0 は 0.99.0 より新しい）", () => {
    expect(latestVersionOf(["v0.99.0", "v0.127.0", "v0.126.2"])).toBe("0.127.0");
  });
  test("版の形でないタグは見ない", () => {
    expect(latestVersionOf(["v0.128.0-beta", "release", "v0.127.0"])).toBe("0.127.0");
    expect(latestVersionOf(["release"])).toBeUndefined();
  });
});

describe("台帳を書いてよいか", () => {
  test("一度も確かめていない間は書かない", () => {
    const gate = new LedgerWriteGate("0.127.0", new MemoryStore(), tags(), fixedNow);
    expect(gate.check()).toMatchObject({ allowed: false, reason: "unchecked" });
  });

  test("本体の最新が取り込んだ版と同じなら書ける", async () => {
    const gate = new LedgerWriteGate("0.127.0", new MemoryStore(), tags("v0.126.2", "v0.127.0"), fixedNow);
    await gate.refresh();
    expect(gate.check()).toEqual({ allowed: true });
  });

  test("本体の版が上がっていたら書かない（知らせに両方の版が出る）", async () => {
    const gate = new LedgerWriteGate("0.127.0", new MemoryStore(), tags("v0.127.0", "v0.128.0"), fixedNow);
    await gate.refresh();
    const answer = gate.check();
    expect(answer).toMatchObject({ allowed: false, reason: "stale", latest: "0.128.0" });
    if (!answer.allowed) expect(answer.message).toContain("0.128.0");
  });

  test("確かめた答えは端末の設定に残り、開き直しても効く", async () => {
    const store = new MemoryStore();
    await new LedgerWriteGate("0.127.0", store, tags("v0.128.0"), fixedNow).refresh();
    expect(store.get(LATEST_BODY_VERSION_KEY)).toEqual({ version: "0.128.0", checkedAt: "2026-11-06T12:00:00.000Z" });
    const reopened = new LedgerWriteGate("0.127.0", store, tags(), fixedNow);
    expect(reopened.check()).toMatchObject({ allowed: false, reason: "stale" });
  });

  test("つながらないときは、覚えている版を変えずに理由を返す", async () => {
    const store = new MemoryStore();
    await new LedgerWriteGate("0.127.0", store, tags("v0.127.0"), fixedNow).refresh();
    const offline = new LedgerWriteGate(
      "0.127.0",
      store,
      async () => {
        throw new TypeError("Failed to fetch");
      },
      fixedNow
    );
    expect(await offline.refresh()).toEqual({ ok: false, detail: "Failed to fetch" });
    expect(offline.check()).toEqual({ allowed: true });
  });

  test("GitHub が断ったとき（403 など）も、覚えている版を変えない", async () => {
    const store = new MemoryStore();
    const gate = new LedgerWriteGate("0.127.0", store, async () => new Response("", { status: 403 }), fixedNow);
    expect(await gate.refresh()).toMatchObject({ ok: false });
    expect(store.values.size).toBe(0);
  });

  test("取り込んだ版が最新のタグより新しくても書ける", async () => {
    const gate = new LedgerWriteGate("0.128.0", new MemoryStore(), tags("v0.127.0"), fixedNow);
    await gate.refresh();
    expect(gate.check()).toEqual({ allowed: true });
  });
});
