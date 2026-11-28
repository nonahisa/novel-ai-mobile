import { describe, expect, it } from "vitest";
import { AIError, buildIssueReport } from "../src/shared";
import {
  FAILURE_LOG_MAX_AGE_DAYS,
  FAILURE_LOG_MAX_BYTES,
  createFailureLog,
  formatFailureRecord,
  pruneFailureLog,
  type FailureLogIo,
} from "../src/platform/failureLog";

/** 手元の時計で作る（記録の時刻は現地時刻） */
const at = (d: number, h = 12, m = 0, s = 0) => new Date(2026, 10, d, h, m, s);

const memoryIo = (initial?: string): FailureLogIo & { text: () => string | undefined; writes: number } => {
  let stored = initial;
  let writes = 0;
  return {
    async read() {
      return stored;
    },
    async write(text: string) {
      writes++;
      stored = text;
    },
    text: () => stored,
    get writes() {
      return writes;
    },
  };
};

const reportOf = (logText: string, now: Date) =>
  buildIssueReport({
    now,
    reportId: "NAI-20261128-abcd",
    rangeHours: 24,
    rangeLabel: "直近24時間",
    environment: { extensionVersion: "0.2.0", vscodeVersion: "-", os: "Android", browser: false, ais: [] },
    logs: [{ label: "失敗の記録", fileName: "actions.log", text: logText }],
    redaction: { characters: [], workNames: [], maskNames: true, redactSecrets: (t) => t },
  });

describe("失敗の記録の1件の形", () => {
  it("本体の actions.log と同じ形（時刻・--- 何をしていて ---・  鍵: 値）で書く", () => {
    const text = formatFailureRecord(at(28, 9, 5, 7), "誤字脱字の確認", [
      ["種別", "timeout"],
      ["詳細", "60秒で返事がありませんでした"],
    ]);
    expect(text).toBe(
      "[2026-11-28 09:05:07] --- 誤字脱字の確認 ---\n  種別: timeout\n  詳細: 60秒で返事がありませんでした\n",
    );
  });

  it("値の改行は空白にして1行に収める（続きの行が別の鍵に読まれないように）", () => {
    const text = formatFailureRecord(at(28), "同期", [["詳細", "一行目\n  種別: うそ\r\n三行目"]]);
    expect(text.split("\n").filter((l) => l.startsWith("  "))).toEqual(["  詳細: 一行目 種別: うそ 三行目"]);
  });

  it("何をしていたかの改行と「---」も崩さない", () => {
    const text = formatFailureRecord(at(28), "保存\n--- にせ ---", []);
    expect(text).toBe("[2026-11-28 12:00:00] --- 保存 - にせ - ---\n");
  });

  it("本体の組み立て（buildIssueReport）が、そのまま失敗として数えて要約に出す", () => {
    const log =
      formatFailureRecord(at(28, 10), "誤字脱字の確認", [["種別", "timeout"], ["使用中のAI", "Gemini / gemini-flash"]]) +
      formatFailureRecord(at(28, 11), "誤字脱字の確認", [["種別", "timeout"]]) +
      formatFailureRecord(at(28, 11, 30), "同期", [["種別", "network"]]);
    const report = reportOf(log, at(28, 12));
    expect(report.failureCount).toBe(3);
    expect(report.summary).toContain("失敗: 2種類・計3回");
    expect(report.summary).toContain("誤字脱字の確認｜種別 timeout｜2回");
    expect(report.summary).toContain("同期｜種別 network｜1回");
  });
});

describe("古い記録と大きさの上限", () => {
  it("上限は7日と1MB（作者の答え 2026-11-28）", () => {
    expect(FAILURE_LOG_MAX_AGE_DAYS).toBe(7);
    expect(FAILURE_LOG_MAX_BYTES).toBe(1_000_000);
  });

  it("7日より古い記録は、続きの行ごと落とす", () => {
    const log =
      formatFailureRecord(at(20, 11), "古い", [["種別", "a"]]) +
      formatFailureRecord(at(21, 13), "新しい", [["種別", "b"]]);
    const pruned = pruneFailureLog(log, at(28, 12));
    expect(pruned).not.toContain("古い");
    expect(pruned).not.toContain("種別: a");
    expect(pruned).toContain("--- 新しい ---");
    expect(pruned).toContain("種別: b");
  });

  it("時刻の無い頭の行（壊れた書きかけ）は捨てる", () => {
    const pruned = pruneFailureLog("  詳細: 迷子\n" + formatFailureRecord(at(28), "同期", []), at(28, 13));
    expect(pruned.startsWith("[2026-11-28 12:00:00]")).toBe(true);
  });

  it("大きさを超えたら、古い記録から1件ずつ落とす（記録の途中では切らない）", () => {
    const one = (i: number) => formatFailureRecord(at(28, 10, 0, i), `作業${i}`, [["詳細", "x".repeat(80)]]);
    const log = Array.from({ length: 10 }, (_, i) => one(i)).join("");
    const size = new TextEncoder().encode(one(0)).byteLength;
    const pruned = pruneFailureLog(log, at(28, 12), size * 3);
    expect(pruned).toBe(one(7) + one(8) + one(9));
  });
});

describe("失敗を書き足す係", () => {
  it("書き足すたびに古い分を落として書く", async () => {
    const io = memoryIo(formatFailureRecord(at(1), "とても古い", []));
    let now = at(28, 12);
    const log = createFailureLog(io, () => now);
    await log.note("同期", new Error("つながりません"));
    now = at(28, 12, 1);
    await log.note("保存", "書けませんでした", { 種別: "path_conflict" });
    const text = io.text()!;
    expect(text).not.toContain("とても古い");
    expect(text).toBe(
      "[2026-11-28 12:00:00] --- 同期 ---\n  種別: Error\n  詳細: つながりません\n" +
        "[2026-11-28 12:01:00] --- 保存 ---\n  種別: path_conflict\n  詳細: 書けませんでした\n",
    );
  });

  it("AI の失敗は、その種類（AIError の kind）を種別にする", async () => {
    const io = memoryIo();
    const log = createFailureLog(io, () => at(28, 12));
    await log.note("誤字脱字", new AIError("時間切れです", "timeout"));
    expect(io.text()).toContain("  種別: timeout\n  詳細: 時間切れです\n");
  });

  it("続けて呼んでも順に書き、取りこぼさない", async () => {
    const io = memoryIo();
    const log = createFailureLog(io, () => at(28, 12));
    await Promise.all([log.note("a", "1"), log.note("b", "2"), log.note("c", "3")]);
    expect(io.text()!.match(/--- [abc] ---/g)).toEqual(["--- a ---", "--- b ---", "--- c ---"]);
  });

  it("書けない・読めない端末でも投げない（失敗の記録のせいで画面を止めない）", async () => {
    const log = createFailureLog(
      {
        read: async () => {
          throw new Error("読めない");
        },
        write: async () => {
          throw new Error("書けない");
        },
      },
      () => at(28),
    );
    await expect(log.note("同期", "x")).resolves.toBeUndefined();
    await expect(log.read()).resolves.toBe("");
  });

  it("読むときも古い分を落として返す", async () => {
    const io = memoryIo(formatFailureRecord(at(1), "とても古い", []) + formatFailureRecord(at(28), "同期", []));
    const log = createFailureLog(io, () => at(28, 13));
    expect(await log.read()).toBe(formatFailureRecord(at(28), "同期", []));
  });
});
