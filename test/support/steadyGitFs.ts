/**
 * 送る・取ってくる・競合の試しを、`.git` を覚える置き場（`createGitFs` の `steadyGitDir`。端末の［送る］［取ってくる］が使う）
 * でももう一度まるごと流すための切り替え（`*Steady.test.ts` が立ててから試しを読み込む）。
 * 運ぶ中身・ぶつかったときの扱い・止める条件が、覚えない置き場と同じことを、同じ試しで見張る
 */
export function steadyGitFsOptions(): { steadyGitDir?: boolean } {
  return (globalThis as { __steadyGitDir?: boolean }).__steadyGitDir ? { steadyGitDir: true } : {};
}
