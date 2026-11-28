import {
  ASSIGNABLE_FEATURE_LABELS,
  buildIssueReport,
  type IssueReport,
  type IssueReportInput,
} from "../shared";
import type { Assignments, DefaultChoice } from "./aiAssignment";
import { CLOUD_PROVIDERS } from "./aiKeys";

/**
 * **障害報告用の記録（モバイル版）**（本体 設計書 8.5。2026-11-28 作者の答え「3つとも作る」）。
 *
 * 組み立て・伏せ方・行の形の見張りは本体の `buildIssueReport` をそのまま使う（写さない）。ここで足すのは：
 *
 * - 環境の欄の行（本体 1.1.0 の口：`environment.product`「製品: モバイル版」と `environment.lines`）。
 *   ボットが読むのは「製品:」「記録の形 N」「報告ID:」の3行だけで、ほかの行はそのまま環境の欄に入る（スレッドにも出る）。
 *   なので**作品の名前・道・鍵は環境の行に書かない**
 * - 再現手順の案内の例（`stepsHint`。モバイル版の操作の例。「（ここに、」で始まり「）」で終わる1行）
 * - 記録は、失敗の記録（`failureLog.ts`。actions.log と同じ形）だけ
 * - 伏せる材料：作品の名前（題とフォルダー名）・人物の名前と別名・端末にある鍵の値
 */

export const PRODUCT_NAME = "モバイル版";

/** 再現手順の案内（モバイル版の操作の例）。形はボットとの約束 */
export const MOBILE_STEPS_HINT =
  "（ここに、押した操作を順に書いてください。例：話の画面の［…］› 投稿しました を押した）";

export type DevicePlatform = "android" | "ios" | "web";

/** 端末の名乗り（User-Agent）から、OS と WebView の行を作る。読めないものは「（不明）」 */
export function deviceLines(platform: DevicePlatform, userAgent: string): string[] {
  const chrome = /Chrome\/(\d+)/.exec(userAgent)?.[1];
  const safari = /Version\/(\d+(?:\.\d+)?)/.exec(userAgent)?.[1];
  if (platform === "android") {
    const android = /Android (\d+(?:\.\d+)?)/.exec(userAgent)?.[1];
    return [`Android: ${android ?? "（不明）"}`, `WebView: ${chrome ? `Chrome ${chrome}` : "（不明）"}`];
  }
  if (platform === "ios") {
    // iPhone は「CPU iPhone OS 17_5」、iPad は Mac の名乗り（版が出ない）なので Safari の版で見る
    const os = /OS (\d+)_(\d+)/.exec(userAgent);
    const ipad = !/iPhone|iPod/.test(userAgent);
    const osLine = os && !/Macintosh/.test(userAgent) ? `${os[1]}.${os[2]}` : safari ? `${safari}（Safari の版から）` : "（不明）";
    return [`${ipad ? "iPadOS" : "iOS"}: ${osLine}`, `WebView: ${safari ? `Safari ${safari}` : "（不明）"}`];
  }
  return ["OS: ブラウザ", `WebView: ${chrome ? `Chrome ${chrome}` : safari ? `Safari ${safari}` : "（不明）"}`];
}

/** AI の行（既定と、機能ごとの割り当て）。モバイル版の AI はいまはクラウドだけ */
export function aiRows(assignments: Assignments, defaultChoice: DefaultChoice): IssueReportInput["environment"]["ais"] {
  const name = (id: string) => CLOUD_PROVIDERS.find((p) => p.id === id)?.keyName ?? id;
  const rows: Array<IssueReportInput["environment"]["ais"][number]> = [];
  if (defaultChoice.provider && defaultChoice.model) {
    rows.push({ label: "既定", provider: name(defaultChoice.provider), model: defaultChoice.model, local: false });
  }
  for (const [feature, choice] of Object.entries(assignments)) {
    if (!choice) continue;
    const label = ASSIGNABLE_FEATURE_LABELS[feature as keyof typeof ASSIGNABLE_FEATURE_LABELS] ?? feature;
    rows.push({ label, provider: name(choice.provider), model: choice.model, local: false });
  }
  return rows;
}

/**
 * 端末にある鍵の値を、そのまま伏せる口（本体の `redactSecrets` の代わり。本体のものは vscode を引く）。
 * 形で拾う網（Bearer・key= など）は本体の伏せ方の中にもある
 */
export function secretRedactor(values: readonly string[]): (text: string) => string {
  const secrets = values.filter((value) => value.length >= 8).sort((a, b) => b.length - a.length);
  return (text) => secrets.reduce((out, secret) => out.split(secret).join("***"), text);
}

export interface MobileIssueReportInput {
  now: Date;
  reportId: string;
  rangeHours: number;
  rangeLabel: string;
  appVersion: string;
  sharedVersion: string;
  platform: DevicePlatform;
  userAgent: string;
  /** 同期の道（GitHub に入っているか） */
  github: boolean;
  ais: IssueReportInput["environment"]["ais"];
  /** 失敗の記録（`failureLog.ts`） */
  failureLog: string;
  /** 作品の名前（題とフォルダー名）。作品ごとに1組 */
  works: ReadonlyArray<readonly string[]>;
  /** 人物の名前と別名（1人ぶんを1組） */
  characters: ReadonlyArray<readonly string[]>;
  maskNames: boolean;
  secrets: readonly string[];
}

export function buildMobileIssueReport(input: MobileIssueReportInput): IssueReport {
  return buildIssueReport({
    now: input.now,
    reportId: input.reportId,
    rangeHours: input.rangeHours,
    rangeLabel: input.rangeLabel,
    environment: {
      product: PRODUCT_NAME,
      lines: [
        `アプリ: ${input.appVersion}`,
        ...deviceLines(input.platform, input.userAgent),
        `本体の部品: ${input.sharedVersion}`,
        `同期: ${input.github ? "GitHub" : "なし"}`,
      ],
      ais: input.ais,
    },
    logs: [{ label: "失敗の記録", fileName: "actions.log", text: input.failureLog }],
    stepsHint: MOBILE_STEPS_HINT,
    redaction: {
      // 端末の作品は置き場の根からの道（`作品/本文/…`）で記録に出る。作品の名前を伏せれば、道の頭も伏せる
      characters: input.characters,
      workNames: [],
      otherWorkNames: input.works.flat(),
      maskNames: input.maskNames,
      redactSecrets: secretRedactor(input.secrets),
    },
  });
}

/** 記録を置いたあとの手順（1行に1操作）。Android と iOS で渡し方が違う */
export function mobileReportSteps(platform: DevicePlatform, fileName: string, folderLabel: string): string[] {
  const pick =
    platform === "ios"
      ? `3. ファイルを選ぶ画面で、「ファイル」から保存した ${fileName} を選ぶ`
      : `3. ファイルを選ぶ画面で、「${folderLabel}」を開いて ${fileName} を選ぶ`;
  return [
    "1. 下の［#不具合報告 を開く］で Discord を開く",
    "2. #不具合報告 で /不具合を報告 と打ち、「添付」の欄を押す",
    pick,
    "4. 送ったあと、出てくる［入力窓を開く］を押す",
    "5. 再現手順・期待した動き・実際の動きを書いて送る",
  ];
}
