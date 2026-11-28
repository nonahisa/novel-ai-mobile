import { describe, expect, it } from "vitest";
import { formatFailureRecord } from "../src/platform/failureLog";
import {
  MOBILE_STEPS_HINT,
  aiRows,
  buildMobileIssueReport,
  deviceLines,
  mobileReportSteps,
  secretRedactor,
  type MobileIssueReportInput,
} from "../src/platform/issueReportMobile";

const NOW = new Date(2026, 10, 28, 12, 0, 0);
const ANDROID_UA =
  "Mozilla/5.0 (Linux; Android 15; SH-M25 Build/S1234; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/131.0.6778.135 Mobile Safari/537.36";
const IPAD_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1";
const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148";

const base = (over: Partial<MobileIssueReportInput> = {}): MobileIssueReportInput => ({
  now: NOW,
  reportId: "NAI-20261128-ab12",
  rangeHours: 24,
  rangeLabel: "直近24時間",
  appVersion: "0.2.0",
  sharedVersion: "v1.1.0",
  platform: "android",
  userAgent: ANDROID_UA,
  github: true,
  ais: [{ label: "既定", provider: "Gemini", model: "gemini-flash", local: false }],
  failureLog: "",
  works: [["灯台守の手紙", "灯台守の手紙_確認用"]],
  // 本体は1字の名前を伏せない（ありふれた字まで潰れる。MIN_NAME_CHARS）ので、2字以上の名前で試す
  characters: [["湊斗", "湊くん"], ["汐里"]],
  maskNames: true,
  secrets: [],
  ...over,
});

/** 環境の欄の行（見出しの下から、次の見出しの手前まで。空行は除く） */
const environment = (summary: string) => {
  const lines = summary.split("\n");
  return lines.slice(lines.indexOf("## 環境") + 1, lines.indexOf("## 何をしたら（再現手順）")).filter((l) => l !== "");
};

describe("端末の行", () => {
  it("Android は版と WebView（Chrome の版）", () => {
    expect(deviceLines("android", ANDROID_UA)).toEqual(["Android: 15", "WebView: Chrome 131"]);
  });
  it("iPhone は OS の版", () => {
    expect(deviceLines("ios", IPHONE_UA)).toEqual(["iOS: 17.5", "WebView: Safari 17.5"]);
  });
  it("iPad は Mac の名乗りなので、Safari の版から見る", () => {
    expect(deviceLines("ios", IPAD_UA)).toEqual(["iPadOS: 18.1（Safari の版から）", "WebView: Safari 18.1"]);
  });
  it("読めなければ（不明）", () => {
    expect(deviceLines("android", "")).toEqual(["Android: （不明）", "WebView: （不明）"]);
  });
});

describe("記録の組み立て（ボットとの約束）", () => {
  it("環境の欄：報告ID・記録の形・製品: モバイル版、続いてアプリ・端末・本体の部品・同期・AI。VS Code の行は無い", () => {
    expect(environment(buildMobileIssueReport(base()).summary)).toEqual([
      "報告ID: NAI-20261128-ab12",
      "記録の形 1",
      "製品: モバイル版",
      "アプリ: 0.2.0",
      "Android: 15",
      "WebView: Chrome 131",
      "本体の部品: v1.1.0",
      "同期: GitHub",
      "AI（既定）: Gemini / gemini-flash（クラウド）",
    ]);
  });

  it("5つの見出しが同じ並びで、再現手順の案内はモバイル版の例（約束の形の1行）", () => {
    const lines = buildMobileIssueReport(base()).summary.split("\n");
    const headings = lines.filter((l) => l.startsWith("## "));
    expect(headings).toEqual(["## 環境", "## 何をしたら（再現手順）", "## 期待した動き", "## 実際の動き", "## 記録（任意）"]);
    expect(lines[lines.indexOf("## 何をしたら（再現手順）") + 1]).toBe(MOBILE_STEPS_HINT);
    expect(MOBILE_STEPS_HINT.startsWith("（ここに、") && MOBILE_STEPS_HINT.endsWith("）")).toBe(true);
  });

  it("ファイル名は報告ID、頭に題「# 障害報告用の記録」（ボットが、ふつうの投稿に貼られた記録を見分ける）", () => {
    const report = buildMobileIssueReport(base());
    expect(report.fileName).toBe("NAI-20261128-ab12.md");
    expect(report.document.split("\n")[0]).toMatch(/^# 障害報告用の記録( |$)/);
  });

  it("失敗の記録を数え、作品と人物の名前は伏せる", () => {
    const failureLog =
      formatFailureRecord(new Date(2026, 10, 28, 11, 0, 0), "保存", [["種別", "path_conflict"], ["詳細", "灯台守の手紙_確認用/本文/第1話.txt に湊斗の名"]]) +
      formatFailureRecord(new Date(2026, 10, 28, 11, 5, 0), "同期（送る）", [["種別", "offline"]]);
    const report = buildMobileIssueReport(base({ failureLog }));
    expect(report.failureCount).toBe(2);
    expect(report.document).not.toContain("灯台守");
    expect(report.document).not.toContain("湊斗");
    expect(report.document).toContain("〈人物A〉");
  });

  it("伏せないを選べば名前は残る", () => {
    const failureLog = formatFailureRecord(new Date(2026, 10, 28, 11, 0, 0), "保存", [["詳細", "汐里の場面"]]);
    expect(buildMobileIssueReport(base({ failureLog, maskNames: false })).document).toContain("汐里");
  });

  it("端末にある鍵の値は、どこに出ても伏せる", () => {
    const key = "AIzaSyD-very-secret-0123456789";
    const failureLog = formatFailureRecord(new Date(2026, 10, 28, 11, 0, 0), "誤字脱字", [["詳細", `鍵 ${key} で失敗`]]);
    const report = buildMobileIssueReport(base({ failureLog, secrets: [key] }));
    expect(report.document).not.toContain(key);
  });

  it("範囲の外の失敗は入れない", () => {
    const failureLog = formatFailureRecord(new Date(2026, 10, 26, 11, 0, 0), "同期", [["種別", "offline"]]);
    expect(buildMobileIssueReport(base({ failureLog })).failureCount).toBe(0);
  });
});

describe("部品", () => {
  it("AI の行：既定と、機能ごとの割り当て", () => {
    const rows = aiRows({ typo: { provider: "claude", model: "claude-x" } } as never, { provider: "gemini", model: "gemini-flash" });
    expect(rows[0]).toEqual({ label: "既定", provider: "Gemini", model: "gemini-flash", local: false });
    expect(rows[1]).toMatchObject({ provider: "Claude", model: "claude-x", local: false });
  });

  it("鍵の伏せ字：短すぎる値は伏せない（ありふれた字まで潰さない）", () => {
    const redact = secretRedactor(["abc", "longer-secret-value"]);
    expect(redact("abc longer-secret-value")).toBe("abc ***");
  });

  it("手順：Android は置いた所、iOS は「ファイル」から選ぶ", () => {
    expect(mobileReportSteps("android", "NAI-x.md", "Documents › 小説執筆")[2]).toContain("「Documents › 小説執筆」を開いて NAI-x.md");
    expect(mobileReportSteps("ios", "NAI-x.md", "")[2]).toContain("「ファイル」から");
  });
});
