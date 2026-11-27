import { escapeHtml } from "./menuScreen";
import type { WorkSyncState } from "../platform/workSync";

/**
 * **同期の画面（G）**（設計書 6章。画面の見本は無いので、作品一覧・話の一覧の札と一覧の形にそろえる）。
 * 文字列で作るので、DOM の無いテストでも中身を確かめられる。配線は `shell.ts`（`#/sync/<作品>`）。
 *
 * - いちばん上に［取ってくる］［送る］（引継ぎ書 59章）。サインインしていなければ、押すと［GitHub と同期］を開く。
 *   GitHub の置き場が分からない作品（origin が無い・GitHub でない・git で持っていない）では灰色
 * - その下に、押した結果の1行（`#syncResult`）
 * - その下に、送っていない話の一覧（話を押すと原稿エディターで開く。消した話は押せない）
 * - 送っていない話が無ければ「同期済み」の印だけ（説明の文を並べない。設計書 4.6）
 * - 競合の［こちら］［あちら］［両方残す］は次の段（取ってこられるようになってから）
 */

/** 消した話の印 */
export const DELETED_STORY_LABEL = "消した";

/** GitHub の置き場が分からない作品で、灰色の［取ってくる］［送る］を押したとき */
export const NO_REMOTE_MESSAGE = "この作品の GitHub の置き場が分かりません";

/**
 * ［取ってくる］［送る］が押せるか。`checking` は調べ終えるまで（灰色・押しても何も言わない）、
 * `signedOut` は押すとサインインの画面、`noRemote` は灰色
 */
export type SyncAccess = "checking" | "ready" | "signedOut" | "noRemote";

function actionButtons(access: SyncAccess): string {
  const button = (label: string, run: "fetch" | "send") => {
    switch (access) {
      case "ready":
        return `<button data-sync-run="${run}">${escapeHtml(label)}</button>`;
      case "signedOut":
        return `<button data-screen="github">${escapeHtml(label)}</button>`;
      case "noRemote":
        return `<button class="planned" aria-disabled="true" data-planned="${NO_REMOTE_MESSAGE}">${escapeHtml(label)}</button>`;
      case "checking":
        return `<button class="planned" aria-disabled="true">${escapeHtml(label)}</button>`;
    }
  };
  return `<div class="seg sync-actions">${button("取ってくる", "fetch")}${button("送る", "send")}</div><p class="sync-result" id="syncResult" role="status"></p>`;
}

/** 取ってきた版と競合した話（リポジトリの中の道）。選んだものは `decision` */
export interface SyncConflictRow {
  path: string;
  /** `merge`：投稿の台帳を両方の印を残して合わせる（選ばなくてよい。押せない行にする。`syncConflict.ts`） */
  decision?: "ours" | "both" | "theirs" | "merge";
}

const DECISION_LABELS = { ours: "こちら", both: "両方", theirs: "あちら", merge: "印を合わせる" } as const;

/** 競合の一覧（取り込むまで出す）。押すと選ぶ画面。選んだ話には選んだものの印 */
function conflictList(root: string, conflicts: readonly SyncConflictRow[]): string {
  if (conflicts.length === 0) return "";
  const undecided = conflicts.filter((row) => !row.decision).length;
  const rows = conflicts
    .map((row) => {
      const name = row.path.slice(row.path.lastIndexOf("/") + 1).replace(/\.txt$/i, "");
      const mark = row.decision
        ? `<span class="flag ok">${DECISION_LABELS[row.decision]}</span>`
        : `<span class="flag shu">選んでください</span>`;
      // 投稿の台帳を合わせる行は押せない（［こちら］を選ぶと、あちらの印を消して送ることになる）
      if (row.decision === "merge") {
        return `<div class="ep" data-merged-ledger="${escapeHtml(row.path)}"><span class="no"></span><span class="name">${escapeHtml(name)}</span><span class="chars">${mark}</span></div>`;
      }
      return `<button class="ep" data-conflict="${escapeHtml(row.path)}" data-root="${escapeHtml(root)}"><span class="no"></span><span class="name">${escapeHtml(name)}</span><span class="chars">${mark}</span></button>`;
    })
    .join("");
  return `<div class="ep-list sync-list conflict-list"><h2 class="chap">${escapeHtml(`競合：${undecided}話`)}</h2>${rows}</div>`;
}

export function renderSyncScreen(
  root: string,
  state: WorkSyncState | undefined,
  access: SyncAccess = "checking",
  conflicts: readonly SyncConflictRow[] = []
): string {
  const actions = actionButtons(state ? access : "noRemote");
  if (!state) return `${actions}<div class="ep-list"><div class="work-empty" aria-hidden="true"></div></div>`;
  const others = state.otherCount > 0 ? `<span class="flag warn">${escapeHtml(`ほかの変更：${state.otherCount}`)}</span>` : "";
  const conflictHtml = conflictList(root, conflicts);
  if (state.unsent.length === 0) {
    const flag = others || (conflictHtml ? "" : `<span class="flag ok">同期済み</span>`);
    return `${actions}${conflictHtml}${flag ? `<p class="sync-state">${flag}</p>` : ""}`;
  }
  const rows = state.unsent
    .map((file) => {
      const name = file.path.slice(file.path.lastIndexOf("/") + 1).replace(/\.txt$/i, "");
      if (file.deleted) {
        return `<div class="ep" aria-disabled="true"><span class="no"></span><span class="name">${escapeHtml(name)}</span><span class="chars"><span class="flag warn">${DELETED_STORY_LABEL}</span></span></div>`;
      }
      return `<button class="ep" data-episode="${escapeHtml(file.path)}" data-root="${escapeHtml(root)}"><span class="no"></span><span class="name">${escapeHtml(name)}</span><span class="chars"></span></button>`;
    })
    .join("");
  return `${actions}${conflictHtml}<div class="ep-list sync-list"><h2 class="chap">${escapeHtml(`送っていない話：${state.unsent.length}`)}${others}</h2>${rows}</div>`;
}
