import { escapeHtml } from "./menuScreen";
import type { ApiFailureKind } from "../platform/githubCommitApi";
import type { GithubRepo, ImportResult } from "../platform/workImport";

/**
 * **GitHub から取り寄せる**（［作品］→ GitHub から取り寄せる。`#/import`。引継ぎ書 65章）。
 * 作者のリポジトリを最近送った順に並べ、押すと浅く取り寄せて、その作品の話の一覧を開く。
 * もう端末にある名前の行は押せず、「取り寄せ済み」の印。説明の文は並べない（設計書 4.6）
 */

export type ImportView =
  | { kind: "busy" }
  | { kind: "signedOut" }
  | { kind: "failed"; reason: ApiFailureKind }
  | { kind: "repos"; repos: GithubRepo[]; existing: ReadonlySet<string> };

export const IMPORTED_LABEL = "取り寄せ済み";

export function failureText(reason: ApiFailureKind): string {
  switch (reason) {
    case "sign_in_again":
      return "GitHub にサインインし直してください。";
    case "offline":
      return "ネットにつながってから、もう一度押してください。";
    case "no_access":
      return "このリポジトリを読めません。";
    case "rate_limited":
      return "GitHub の回数の上限に当たりました。しばらく待ってから押してください。";
    case "server":
      return "GitHub の側で不具合が起きています。しばらく待ってから押してください。";
    default:
      return "取り寄せられませんでした。";
  }
}

export function importResultText(result: ImportResult): string | undefined {
  switch (result.kind) {
    case "imported":
      return undefined;
    case "exists":
      return "同じ名前の作品が、もう端末にあります。";
    case "bad_name":
      return "この名前のリポジトリは取り寄せられません。";
    case "failed":
      return failureText(result.reason);
  }
}

export function renderImportView(view: ImportView): string {
  switch (view.kind) {
    case "busy":
      return `<div class="ep-list" aria-busy="true"><div class="work-empty" aria-hidden="true"></div></div>`;
    case "signedOut":
      return `<div class="gh-panel"><button class="primary" data-screen="github">サインイン</button></div>`;
    case "failed":
      return `<div class="gh-panel"><p class="gh-state"><span class="flag warn">${escapeHtml(failureText(view.reason))}</span></p><button data-import-retry>もう一度</button></div>`;
    case "repos": {
      if (view.repos.length === 0) return `<div class="ep-list"><div class="work-empty" aria-hidden="true"></div></div>`;
      const rows = view.repos
        .map((repo) => {
          const name = `<span class="no"></span><span class="name">${escapeHtml(repo.name)}</span>`;
          if (view.existing.has(repo.name)) {
            return `<div class="ep" aria-disabled="true">${name}<span class="chars"><span class="flag ok">${IMPORTED_LABEL}</span></span></div>`;
          }
          return `<button class="ep" data-import="${escapeHtml(`${repo.owner}/${repo.name}`)}">${name}<span class="chars"></span></button>`;
        })
        .join("");
      return `<p class="sync-result" id="importResult" role="status"></p><div class="ep-list import-list">${rows}</div>`;
    }
  }
}
