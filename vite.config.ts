import { readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import { SHARED_SUBSTITUTIONS } from "./substitutions.ts";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const SHARED_ROOT = path.join(ROOT, "node_modules", "novel-ai-assistant");

/**
 * 本体の部品の中から読まれる一部のファイルを、モバイル版の部品へ差し替える
 * （一覧と理由は `substitutions.ts`）。
 *
 * **本体の部品の中から読まれたときだけ**差し替える。名前（`./fetchTimeouts`）だけで
 * 当てると、関係の無いファイルまで巻き込むため、読んだ側の場所と行き先の両方を見る。
 */
function substituteSharedParts(): Plugin {
  const targets = new Map(
    Object.entries(SHARED_SUBSTITUTIONS).map(([from, to]) => [
      path.normalize(path.join(SHARED_ROOT, from)),
      path.join(ROOT, to),
    ])
  );
  return {
    name: "novel-ai-mobile:substitute-shared-parts",
    enforce: "pre",
    resolveId(source, importer) {
      if (!importer || !source.startsWith(".")) return null;
      const from = path.normalize(importer.split("?")[0]);
      if (!from.startsWith(path.normalize(SHARED_ROOT))) return null;
      const target = path.normalize(path.resolve(path.dirname(from), source)).replace(/\.(js|ts)$/, "");
      return targets.get(target) ?? null;
    },
  };
}

/**
 * 取り込んでいる本体の版。本体の package.json から読む（画面と動作確認ページに出す）。
 * 本体の package.json は丸ごと束に入れると重い（VS Code の設定の定義が大半）ので、版だけを埋める。
 */
const sharedVersion: string = JSON.parse(
  readFileSync(new URL("./node_modules/novel-ai-assistant/package.json", import.meta.url), "utf8")
).version;

/** モバイル版そのものの版（`package.json`。Android・iOS の版の名前とそろえる） */
const appVersion: string = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")).version;

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
  plugins: [substituteSharedParts()],
  define: {
    __SHARED_VERSION__: JSON.stringify(sharedVersion),
    __APP_VERSION__: JSON.stringify(appVersion),
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
