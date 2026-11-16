import { describe, expect, test } from "vitest";
import { createAutoFetch, type AutoFetchDeps } from "../src/app/autoFetch";
import type { SyncOutcome } from "../src/platform/workSyncRun";

/** 自動の取得の段取り（`src/app/autoFetch.ts`。引継ぎ書 66章）。作品の名前は作り物 */

function deps(overrides: Partial<AutoFetchDeps> = {}) {
  let clock = 0;
  const calls: string[] = [];
  const base: AutoFetchDeps = {
    listRepos: async () => ["灯台守_確認用", "雨の駅_確認用"],
    token: async () => "tkn",
    fetchOne: async (root): Promise<SyncOutcome> => {
      calls.push(root);
      return root === "灯台守_確認用" ? { kind: "fetched", taken: 1, kept: 0 } : { kind: "held" };
    },
    canRun: () => true,
    now: () => clock,
  };
  return { d: { ...base, ...overrides }, calls, tick: (ms: number) => (clock += ms) };
}

describe("自動の取得", () => {
  test("作品ごとに取りに行き、取り込んだ作品を返す。5分たつまで次は走らない", async () => {
    const { d, calls, tick } = deps();
    const auto = createAutoFetch(d);
    expect(await auto.run()).toEqual({ fetched: ["灯台守_確認用"] });
    expect(calls).toEqual(["灯台守_確認用", "雨の駅_確認用"]);
    tick(4 * 60_000);
    expect(await auto.run()).toBeUndefined();
    tick(60_000);
    expect(await auto.run()).toEqual({ fetched: ["灯台守_確認用"] });
  });

  test("原稿を開いているあいだは走らない。途中で開いたら次の作品へ進まない", async () => {
    let open = true;
    const { d, calls } = deps({ canRun: () => !open });
    const auto = createAutoFetch(d);
    expect(await auto.run()).toBeUndefined();
    expect(calls).toEqual([]);
    open = false;
    const mid = deps({
      canRun: () => !open,
      fetchOne: async () => {
        open = true; // 1つ目のあいだに作者が原稿を開いた
        return { kind: "up_to_date" };
      },
    });
    const auto2 = createAutoFetch(mid.d);
    expect(await auto2.run()).toEqual({ fetched: [] });
  });

  test("サインインしていなければ何もしない（あとでサインインすれば、待たずに走る）。重ねて走らせない。失敗は黙って次へ", async () => {
    let token: string | undefined;
    const { d, calls } = deps({ token: async () => token });
    const auto = createAutoFetch(d);
    expect(await auto.run()).toBeUndefined();
    token = "tkn";
    const first = auto.run();
    expect(await auto.run()).toBeUndefined();
    expect(await first).toEqual({ fetched: ["灯台守_確認用"] });
    expect(calls).toHaveLength(2);

    const failing = deps({
      fetchOne: async (root) => {
        if (root === "灯台守_確認用") throw new Error("届かない");
        return { kind: "fetched", taken: 1, kept: 0 };
      },
    });
    expect(await createAutoFetch(failing.d).run()).toEqual({ fetched: ["雨の駅_確認用"] });
  });
});
