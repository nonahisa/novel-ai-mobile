import { escapeHtml } from "./menuScreen";
import {
  decideNotice,
  dueForCheck,
  readUpdateSettings,
  writeUpdateSettings,
  type Notice,
  type UpdateAsset,
  type UpdateTicket,
} from "../platform/appUpdate";

/**
 * **更新**（［ほか］→ 設定 → 更新。`#/update`）と、**新しい版の知らせ**（引継ぎ書 154章。共通の決まりは統合の
 * `docs/更新の仕組み_共通.md`）。
 *
 * - 知らせには、新しい版・中身の要約・［入れる］［あとで］［この版は飛ばす］を出す。入れ替えは作者が押したときだけ
 * - iOS は知らせだけ（入れ替えは Mac・TestFlight）。Android の［入れる］は、入れ替えの部品（`install`）があるときだけ出す
 * - 自動の確かめは、設定がオンのときに、起動したときと前に出たときで1日1回まで。［今すぐ確かめる］は押したときに1回
 */

export interface UpdateDeps {
  storage: Storage | undefined;
  /** 今の版（`__APP_VERSION__`） */
  current: string;
  /** "android" | "ios" | "web" */
  platform: string;
  /** 最新の札を取ってきて照らす（落ちたら undefined） */
  check(): Promise<UpdateTicket | undefined>;
  /** Android：APK を取ってきて照らし、端末のインストーラーへ渡す。無ければ［入れる］を出さない */
  install?(asset: UpdateAsset): Promise<void>;
  now?(): number;
  /** 作者がまだ選んでいないときの自動の確かめ（無ければ `UPDATE_CHECK_DEFAULT`。試しのブラウザでは false） */
  autoDefault?: boolean;
}

export type NoticeAnswer = "install" | "later" | "skip";

/** 新しい版の知らせの窓。答えを返す（背景・［戻る］は［あとで］） */
export function showUpdateNotice(notice: Extract<Notice, { kind: "new" }>, canInstall: boolean, platform: string): Promise<NoticeAnswer> {
  return new Promise((resolve) => {
    const backdrop = document.createElement("div");
    backdrop.className = "dialog-backdrop";
    const lines = notice.summary.slice(0, 3).map((line) => `<li>${escapeHtml(line)}</li>`).join("");
    const how = notice.tooOld
      ? "今の版からは直に上げられません。パソコンの母艦に入れ直しを頼んでください"
      : platform === "ios"
        ? "iPad・iPhone へは、Mac から入れます"
        : canInstall
          ? "［入れる］で取り寄せ、照らしてから端末のインストーラーへ渡します。作品と設定はそのまま残ります"
          : "入れ替えの道はこれから作ります";
    const install = canInstall && !notice.tooOld && platform === "android" ? `<button type="button" class="primary" data-answer="install">入れる</button>` : "";
    backdrop.innerHTML =
      `<div class="dialog update-notice" role="dialog" aria-modal="true">` +
      `<p class="dialog-message">${escapeHtml(`新しい版 ${notice.version} があります`)}</p>` +
      (lines ? `<ul class="update-summary">${lines}</ul>` : "") +
      `<p class="update-how">${escapeHtml(how)}</p>` +
      `<div class="dialog-actions"><button type="button" data-answer="skip">この版は飛ばす</button><button type="button" data-answer="later">あとで</button>${install}</div></div>`;
    const close = (answer: NoticeAnswer) => {
      backdrop.remove();
      resolve(answer);
    };
    backdrop.addEventListener("click", (e) => {
      const target = (e.target as HTMLElement).closest<HTMLElement>("[data-answer]");
      if (target) close(target.dataset.answer as NoticeAnswer);
      else if (e.target === backdrop) close("later");
    });
    document.body.appendChild(backdrop);
    backdrop.querySelector<HTMLButtonElement>('[data-answer="later"]')!.focus({ preventScroll: true });
  });
}

/** 知らせを出して、答えに合わせて覚える・入れる */
async function answerNotice(notice: Extract<Notice, { kind: "new" }>, deps: UpdateDeps): Promise<NoticeAnswer> {
  const answer = await showUpdateNotice(notice, deps.install !== undefined && notice.asset !== undefined, deps.platform);
  if (answer === "skip") writeUpdateSettings(deps.storage, { ...readUpdateSettings(deps.storage, deps.autoDefault), skipped: notice.version });
  if (answer === "install" && notice.asset && deps.install) await deps.install(notice.asset);
  return answer;
}

/**
 * 起動したとき・前に出たときの自動の確かめ。設定がオフ・1日たっていない・取れなかったら何もしない。
 * 知らせを出したら true
 */
export async function runAutoUpdateCheck(deps: UpdateDeps): Promise<boolean> {
  const settings = readUpdateSettings(deps.storage, deps.autoDefault);
  const now = (deps.now ?? Date.now)();
  if (!settings.auto || !dueForCheck(now, settings.lastCheck)) return false;
  // 先に時を書く（落ちても、次の確かめまで黙る）
  writeUpdateSettings(deps.storage, { ...settings, lastCheck: now });
  const ticket = await deps.check();
  if (!ticket) return false;
  const notice = decideNotice(ticket, deps.current, readUpdateSettings(deps.storage, deps.autoDefault).skipped, deps.platform);
  if (notice.kind !== "new") return false;
  await answerNotice(notice, deps);
  return true;
}

function renderUpdateScreen(current: string, auto: boolean): string {
  const seg = (on: boolean, label: string) => `<button data-update-auto="${on ? "on" : "off"}" aria-pressed="${auto === on}">${label}</button>`;
  return (
    `<section class="menu-section"><h2>今の版</h2><p class="update-current">${escapeHtml(`モバイル版 ${current}`)}</p></section>` +
    `<section class="menu-section"><h2>新しい版を自動で確かめる</h2><div class="seg update-auto">${seg(true, "確かめる")}${seg(false, "確かめない")}</div>` +
    `<p class="update-note">起動したときに、1日1回まで GitHub の Release を見に行きます。送るのは見に行く問い合わせだけで、作品や設定は送りません</p></section>` +
    `<section class="menu-section"><h2>今すぐ</h2><button data-update="check">今すぐ確かめる</button><p class="update-result" role="status"></p></section>`
  );
}

/** ［ほか］→ 設定 → 更新 */
export function mountUpdateScreen(slot: HTMLElement, deps: UpdateDeps, stillHere: () => boolean): void {
  const paint = () => {
    slot.innerHTML = renderUpdateScreen(deps.current, readUpdateSettings(deps.storage, deps.autoDefault).auto);
  };
  paint();
  slot.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    const auto = target.closest<HTMLElement>("[data-update-auto]");
    if (auto) {
      writeUpdateSettings(deps.storage, { ...readUpdateSettings(deps.storage, deps.autoDefault), auto: auto.dataset.updateAuto === "on" });
      paint();
      return;
    }
    const button = target.closest<HTMLButtonElement>('[data-update="check"]');
    if (!button) return;
    const result = slot.querySelector<HTMLElement>(".update-result")!;
    button.disabled = true;
    result.textContent = "確かめています…";
    void deps.check().then(async (ticket) => {
      if (!stillHere()) return;
      button.disabled = false;
      writeUpdateSettings(deps.storage, { ...readUpdateSettings(deps.storage, deps.autoDefault), lastCheck: (deps.now ?? Date.now)() });
      if (!ticket) {
        result.textContent = "確かめられませんでした。通信のあるところで、もう一度押してください";
        return;
      }
      // 押して確かめたときは、飛ばした版も知らせる
      const notice = decideNotice(ticket, deps.current, undefined, deps.platform);
      if (notice.kind !== "new") {
        result.textContent = `いまの版が最新です（${deps.current}）`;
        return;
      }
      result.textContent = `新しい版 ${notice.version} があります`;
      await answerNotice(notice, deps);
    });
  });
}
