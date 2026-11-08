import { describe, expect, test } from "vitest";
import { createTrialLog, trialLogPath } from "../src/app/trialLogFile";

/** 試しの画面の記録をファイルにも書く（2026-11-08 母艦：iPad の記録を Mac のセッションが devicectl で取り出す） */
function fakeDeps() {
  const writes: { path: string; data: string }[] = [];
  let pending: (() => void) | undefined;
  return {
    writes,
    fire: () => pending?.(),
    deps: {
      write: async (path: string, data: string) => {
        writes.push({ path, data });
      },
      setTimer: (fn: () => void) => {
        pending = fn;
        return 1;
      },
      clearTimer: () => {
        pending = undefined;
      },
    },
  };
}

describe("試しの画面の記録のファイル", () => {
  test("名前に開いた日時が入り、原稿（works/）とは別の場所", () => {
    expect(trialLogPath(new Date(2026, 10, 8, 16, 3, 5))).toBe("trial-log/ime-log-20261108-160305.txt");
  });
  test("記録が増えて落ち着いたら、古い順に全部を1回書く", async () => {
    const f = fakeDeps();
    const log = createTrialLog(new Date(2026, 10, 8, 9, 0, 0), f.deps);
    log.add("1行目");
    log.add("2行目");
    expect(f.writes).toHaveLength(0);
    f.fire();
    await log.flush();
    expect(f.writes[0]).toEqual({ path: "trial-log/ime-log-20261108-090000.txt", data: "1行目\n2行目\n" });
  });
  test("行が多すぎたら、古い行から捨てる", async () => {
    const f = fakeDeps();
    const log = createTrialLog(new Date(), f.deps, 500, 2);
    for (const l of ["a", "b", "c"]) log.add(l);
    await log.flush();
    expect(f.writes.at(-1)?.data).toBe("b\nc\n");
  });
  test("書けなくても止まらない", async () => {
    const log = createTrialLog(new Date(), { write: async () => { throw new Error("no"); }, setTimer: () => 0, clearTimer: () => undefined });
    log.add("x");
    await expect(log.flush()).resolves.toBeUndefined();
  });
});
