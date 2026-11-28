import { Capacitor } from "@capacitor/core";
import { Directory, Encoding, Filesystem } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import {
  BUG_REPORT_CHANNEL_URL,
  COMMUNITY_DISCORD_URL,
  ISSUE_REPORT_RANGES,
  SHARED_VERSION,
  makeIssueReportId,
  type IssueReport,
} from "../shared";
import { readAiChoices } from "../platform/aiAssignment";
import { CLOUD_PROVIDERS } from "../platform/aiKeys";
import type { DeviceSettings } from "../platform/deviceSettings";
import { currentFailureLog } from "../platform/failureLog";
import type { FileStore } from "../platform/fileStore";
import {
  aiRows,
  buildMobileIssueReport,
  mobileReportSteps,
  placeReportFailure,
  type DevicePlatform,
} from "../platform/issueReportMobile";
import { GITHUB_TOKEN_SECRET, type SecretVault } from "../platform/secretVault";
import { readWorkLayout, findWorkRoots, folderTitle } from "../platform/workScan";
import { readWorkTerms } from "../platform/workTerms";
import { escapeHtml, renderAppBar } from "./menuScreen";

/**
 * **障害報告用の記録を書き出す**（［ほか］→ ヘルプ。本体の「障害報告用の記録」と同じ記録の形。2026-11-28 作者の答え）。
 *
 * 1. 範囲と、人物名・作品名を伏せるかを選んで［記録を作る］→ 伏せた数と要約を見せる（ここではまだどこにも置かない）
 * 2. ［Discord で報告する］で記録の `.md` を置き、手順と #不具合報告 へのリンクを出す
 *    - Android：誰でも見られる「Documents/小説執筆」に置く（Discord の添付の欄のファイルを選ぶ画面から選べる）
 *    - iOS：共有の画面を開く（「"ファイル"に保存」で保存してもらう）
 *    - **共有の画面で Discord を選ぶと、ふつうの投稿としてチャンネルに出る**（会員みんなが読める）。Android は共有の画面を
 *      使わない。iOS は手順の上で「Discord は選ばない」と書く
 * 3. ［要約をコピー］は、添付しないで送る人のため
 *
 * 送る口は作らない（本体 8.5 の裁定のまま）。記録に入れるのは失敗の記録（`platform/failureLog.ts`）と環境の行だけ。
 */

export const REPORT_FOLDER = "小説執筆";
const ANDROID_FOLDER_LABEL = `Documents › ${REPORT_FOLDER}`;

export interface IssueReportScreenDeps {
  store: FileStore;
  vault: SecretVault;
  settings: () => Promise<DeviceSettings>;
  toast: (message: string) => void;
  stillHere: () => boolean;
  now?: () => Date;
}

function platform(): DevicePlatform {
  const name = Capacitor.getPlatform();
  return name === "android" || name === "ios" ? name : "web";
}

/** 端末の作品の名前（題とフォルダー名）と人物の名前。読めない作品は飛ばす（記録を作るのを止めない） */
async function namesOnDevice(store: FileStore): Promise<{ works: string[][]; characters: string[][] }> {
  const works: string[][] = [];
  const characters: string[][] = [];
  for (const root of await findWorkRoots(store).catch(() => [] as string[])) {
    const leaf = root.slice(root.lastIndexOf("/") + 1);
    // 作品の名前：フォルダー名と、作品の設定の題（`workTitle`。作品一覧に出る名前）。題が読めなければフォルダー名だけ
    const names = new Set([folderTitle(root), leaf]);
    try {
      const layout = await readWorkLayout(store, root);
      names.add(layout.title);
      const byId = new Map<string, string[]>();
      for (const entry of (await readWorkTerms(store, layout.settings)).entries) {
        if (entry.kind !== "character") continue;
        byId.set(entry.id, [...(byId.get(entry.id) ?? []), entry.text]);
      }
      characters.push(...byId.values());
    } catch {
      // 設定の読めない作品は、作品の名前だけ伏せる
    }
    works.push([...names]);
  }
  return { works, characters };
}

async function secretsOnDevice(vault: SecretVault): Promise<string[]> {
  const names = [GITHUB_TOKEN_SECRET, ...CLOUD_PROVIDERS.map((provider) => provider.secret)];
  const values = await Promise.all(names.map((name) => vault.get(name).catch(() => undefined)));
  return values.filter((value): value is string => typeof value === "string" && value !== "");
}

function renderForm(): string {
  const ranges = ISSUE_REPORT_RANGES.map(
    (range, index) =>
      `<label class="radio-row"><input type="radio" name="reportRange" value="${range.hours}"${index === 0 ? " checked" : ""}> ${escapeHtml(range.label)}</label>`,
  ).join("");
  return (
    `<div class="report">` +
    `<p class="report-lead">不具合を知らせるための記録を作ります。原稿と相談のやり取りは入れません。</p>` +
    `<fieldset class="report-range"><legend>範囲</legend>${ranges}</fieldset>` +
    `<label class="check-row"><input type="checkbox" id="reportMask" checked> 人物名・作品名を伏せる</label>` +
    `<div class="menu-items"><button class="menu-item built" id="reportMake">記録を作る</button></div>` +
    `<div id="reportResult"></div>` +
    `</div>`
  );
}

export function renderReportResult(report: IssueReport): string {
  const counts = [
    `原稿の本文と抜粋 ${report.stats.body + report.stats.longRuns}か所`,
    `AIの応答 ${report.stats.response}か所`,
    `人物名・作品名 ${report.stats.names}か所`,
    `鍵らしき文字列 ${report.stats.secrets}行`,
    `URL ${report.stats.urls}か所`,
  ];
  return (
    `<p class="report-id" id="reportId">報告ID：${escapeHtml(report.reportId)}（失敗 ${report.failureCount}件）</p>` +
    `<p class="report-masked">伏せたもの：${escapeHtml(counts.join("・"))}</p>` +
    `<details class="report-summary"><summary>要約を見る</summary><pre id="reportSummary">${escapeHtml(report.summary)}</pre></details>` +
    `<div class="menu-items">` +
    `<button class="menu-item built" id="reportDiscord">Discord で報告する</button>` +
    `<button class="menu-item built" id="reportCopy">要約をコピー</button>` +
    `</div>` +
    `<div id="reportSteps"></div>`
  );
}

export function renderReportSteps(steps: readonly string[], where: string, warnShare: boolean): string {
  return (
    `<p class="report-where" id="reportWhere">${escapeHtml(where)}</p>` +
    (warnShare
      ? `<p class="flag warn long" id="reportShareWarn">共有の画面では「"ファイル"に保存」を選んでください。Discord を選ぶと、ふつうの投稿になって会員みんなに見えます</p>`
      : "") +
    `<ol class="report-steps">${steps.map((step) => `<li>${escapeHtml(step.replace(/^\d+\.\s*/, ""))}</li>`).join("")}</ol>` +
    `<div class="menu-items">` +
    `<a class="menu-item built" id="reportChannel" href="${escapeHtml(BUG_REPORT_CHANNEL_URL)}">#不具合報告 を開く</a>` +
    `<a class="menu-item built" id="reportJoin" href="${escapeHtml(COMMUNITY_DISCORD_URL)}">まだ入っていない人は：サーバーに参加する</a>` +
    `</div>`
  );
}

/** 記録を置く。置いた場所の説明を返す */
async function placeReport(report: IssueReport, device: DevicePlatform): Promise<{ where: string; warnShare: boolean }> {
  if (device === "ios") {
    await Filesystem.writeFile({ path: `issue-report/${report.fileName}`, data: report.document, directory: Directory.Cache, encoding: Encoding.UTF8, recursive: true });
    const { uri } = await Filesystem.getUri({ path: `issue-report/${report.fileName}`, directory: Directory.Cache });
    try {
      await Share.share({ title: report.fileName, files: [uri] });
    } catch {
      // 共有の画面を閉じただけでも投げる。手順は出す（もう一度押せばまた開く）
    }
    return { where: `${report.fileName} を共有の画面に渡しました`, warnShare: true };
  }
  await Filesystem.writeFile({
    path: `${REPORT_FOLDER}/${report.fileName}`,
    data: report.document,
    directory: Directory.Documents,
    encoding: Encoding.UTF8,
    recursive: true,
  });
  return { where: `${ANDROID_FOLDER_LABEL} に ${report.fileName} を置きました`, warnShare: false };
}

export function mountIssueReportScreen(screen: HTMLElement, deps: IssueReportScreenDeps): void {
  screen.innerHTML = `${renderAppBar("障害報告用の記録", { back: true })}${renderForm()}`;
  const result = screen.querySelector<HTMLElement>("#reportResult")!;
  const make = screen.querySelector<HTMLButtonElement>("#reportMake")!;
  const now = deps.now ?? (() => new Date());
  let report: IssueReport | undefined;
  let busy = false;

  make.addEventListener("click", () => {
    if (busy) return;
    busy = true;
    make.disabled = true;
    result.innerHTML = `<p class="report-busy" aria-busy="true">記録を作っています…</p>`;
    void (async () => {
      try {
        const hours = Number(screen.querySelector<HTMLInputElement>('input[name="reportRange"]:checked')?.value ?? 24);
        const range = ISSUE_REPORT_RANGES.find((r) => r.hours === hours) ?? ISSUE_REPORT_RANGES[0]!;
        const settings = await deps.settings();
        const { assignments, defaultChoice } = readAiChoices(settings);
        const [names, secrets, failureLog, github] = await Promise.all([
          namesOnDevice(deps.store),
          secretsOnDevice(deps.vault),
          currentFailureLog()?.read() ?? Promise.resolve(""),
          deps.vault.get(GITHUB_TOKEN_SECRET).then((token) => token !== undefined).catch(() => false),
        ]);
        const at = now();
        report = buildMobileIssueReport({
          now: at,
          reportId: makeIssueReportId(at),
          rangeHours: range.hours,
          rangeLabel: range.label,
          appVersion: __APP_VERSION__,
          sharedVersion: SHARED_VERSION,
          platform: platform(),
          userAgent: navigator.userAgent,
          github,
          ais: aiRows(assignments, defaultChoice),
          failureLog,
          works: names.works,
          characters: names.characters,
          maskNames: screen.querySelector<HTMLInputElement>("#reportMask")!.checked,
          secrets,
        });
        if (deps.stillHere()) result.innerHTML = renderReportResult(report);
      } catch (error) {
        if (deps.stillHere()) result.innerHTML = `<p class="flag shu long">記録を作れませんでした（${escapeHtml(error instanceof Error ? error.message : String(error))}）</p>`;
      } finally {
        busy = false;
        make.disabled = false;
      }
    })();
  });

  result.addEventListener("click", (event) => {
    const target = (event.target as HTMLElement).closest<HTMLElement>("#reportDiscord,#reportCopy");
    if (!target || !report) return;
    const current = report;
    if (target.id === "reportCopy") {
      void navigator.clipboard
        .writeText(current.summary)
        .then(() => deps.toast("要約を写しました"))
        .catch(() => deps.toast("写せませんでした"));
      return;
    }
    const device = platform();
    void placeReport(current, device)
      .then(({ where, warnShare }) => {
        if (!deps.stillHere()) return;
        const steps = mobileReportSteps(device, current.fileName, ANDROID_FOLDER_LABEL);
        result.querySelector<HTMLElement>("#reportSteps")!.innerHTML = renderReportSteps(steps, where, warnShare);
      })
      .catch((error: unknown) => deps.toast(placeReportFailure(error)));
  });
}
