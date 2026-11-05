import { readFileSync } from "node:fs";
import { defineConfig } from "vite";

/**
 * 取り込んでいる本体の版。本体の package.json から読む（画面と動作確認ページに出す）。
 * 本体の package.json は丸ごと束に入れると重い（VS Code の設定の定義が大半）ので、版だけを埋める。
 */
const sharedVersion: string = JSON.parse(
  readFileSync(new URL("./node_modules/novel-ai-assistant/package.json", import.meta.url), "utf8")
).version;

/**
 * 開発中の3段階の確かめ方（設計メモ「テストの3段階」）を、この設定で支える。
 *
 * 1. パソコンのブラウザ  … `npm run dev` → http://localhost:5173
 * 2. スマホのブラウザ    … 同じWi-Fiから http://<パソコンのIP>:5173
 *                          ビルドもインストールも要らず、指で触れる。
 *                          日本語入力と縦書きの確認はここでやる
 * 3. APK                 … `npm run android`
 *
 * `host: true` が2段階目の肝。既定（localhost限定）のままだと、
 * スマホからは決してつながらない。
 */
export default defineConfig({
  define: {
    __SHARED_VERSION__: JSON.stringify(sharedVersion),
  },
  resolve: {
    alias: [
      /*
        本体の `core/pathText.ts`・`core/paths.ts` は Node の `path` を import する。
        本体のブラウザ版も同じに `path-browserify` へ差し替えている（本体の esbuild.js）
      */
      { find: /^path$/, replacement: "path-browserify" },
    ],
  },
  server: {
    host: true,
    port: 5173,
    strictPort: true,
  },
  build: {
    // AndroidのWebViewはPlayストア経由で更新されるので、
    // minSdk 24（Android 7）でも新しい文法が使える
    target: "es2022",
  },
});
