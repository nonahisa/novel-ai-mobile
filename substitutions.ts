/**
 * 本体の部品のうち、**モバイル版の部品へ差し替えるもの**の一覧（設計書 2.3）。
 *
 * 本体の `ai/httpClient.ts` などは、そのまま使いたいが、中で
 * `./fetchTimeouts`（Node の undici に頼る）を読む。本体の部品は直さない・
 * 写さない決まりなので、**読み込みの段で行き先だけを差し替える**。
 *
 * - 左：本体のリポジトリの中の場所（拡張子なし）
 * - 右：このリポジトリの中の、代わりのファイル
 *
 * `vite.config.ts`（組み立てとテスト）と `test/androidReach.test.ts`
 * （端末で落ちないかの見張り）の両方がこの一覧を読む。片方にだけ書くと、
 * 見張りが本体の元の部品を見てしまい、差し替えた意味を確かめられない。
 */
export const SHARED_SUBSTITUTIONS: Readonly<Record<string, string>> = {
  "src/ai/fetchTimeouts": "src/platform/fetchTimeouts.ts",
};
