import { describe, expect, test } from "vitest";
import { backgroundWork, whileWorking, type BackgroundWork } from "../src/platform/backgroundWork";

/** 長い AI の処理を裏でも続ける（段2。設計書 7章「続ける」）。端末の前面サービスは実機で見る。ここは始め・進み・止めの順 */
function recording(): { work: BackgroundWork; log: string[] } {
  const log: string[] = [];
  return {
    log,
    work: {
      start: async (title, text, max) => void log.push(`start ${title} ${text} ${max}`),
      update: async (text, progress, max) => void log.push(`update ${text} ${progress}/${max}`),
      stop: async () => void log.push("stop"),
    },
  };
}

describe("裏でも続ける", () => {
  test("始めてから、1回ごとに進み具合を出し、終わったら止める", async () => {
    const { work, log } = recording();
    const result = await whileWorking(work, "誤字脱字（2話）", 2, async (step) => {
      step(1);
      step(2);
      return "済み";
    });
    expect(result).toBe("済み");
    expect(log).toEqual(["start 誤字脱字（2話） AI に見せています（0/2） 2", "update AI に見せています（1/2） 1/2", "update AI に見せています（2/2） 2/2", "stop"]);
  });
  test("失敗しても止める（通知を残さない）", async () => {
    const { work, log } = recording();
    await expect(
      whileWorking(work, "推敲", 1, async () => {
        throw new Error("待ち切れました");
      })
    ).rejects.toThrow("待ち切れました");
    expect(log.at(-1)).toBe("stop");
  });
  test("ブラウザ（と iOS）では何もしない", async () => {
    const work = backgroundWork();
    await expect(work.start("t", "x", 1)).resolves.toBeUndefined();
    await expect(work.stop()).resolves.toBeUndefined();
  });
});
