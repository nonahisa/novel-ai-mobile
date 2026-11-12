import { defineConfig, devices } from "@playwright/test";

/**
 * **画面の自動テストと、画面の写真の撮影**（Android詳細設計書 9章「画面の自動テスト」。
 * 2026-11-12 作者「テストと画面ショットの撮影は自動化してほしい。撮影は製品には入れないでほしい」）。
 *
 * - `pnpm run e2e`   … 画面のテスト（`e2e/screens.e2e.ts`）
 * - `pnpm run shots` … 画面の写真を `docs/画面の写真/自動/` に撮る（`e2e/shots.e2e.ts`。リポジトリには入れない）
 * - `pnpm exec playwright test` … 両方
 *
 * どちらも組み立てた画面（`vite build` → `vite preview`）を、パソコンのブラウザにスマホの幅とタッチで出して見る。
 * **製品には入らない**：`e2e/` は `src/` から読まれず、`@playwright/test` は開発用の部品（devDependencies）。
 * 開発用のサーバー（`pnpm run dev`）は本体の部品の読み込みで止まるので使わない。
 *
 * ブラウザは、Windows では入っている Edge を使う（取り寄せが要らない）。ほかの端末では
 * `pnpm exec playwright install chromium` で Chromium を入れる。
 */

const PORT = 4174;
const channel = process.platform === "win32" ? "msedge" : undefined;

/** 3段の代表の幅（設計書 9章）。狭い段はスマホ（タッチ・画面の拡大なし） */
export const SIZES = {
  phone: { width: 360, height: 800 },
  mid: { width: 800, height: 1280 },
  wide: { width: 1280, height: 800 },
} as const;

const phone = {
  ...devices["Pixel 7"],
  viewport: SIZES.phone,
  deviceScaleFactor: 2,
  defaultBrowserType: "chromium" as const,
};

export default defineConfig({
  testDir: "e2e",
  testMatch: "**/*.e2e.ts",
  outputDir: "test-results/e2e",
  fullyParallel: true,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    channel,
    locale: "ja-JP",
  },
  projects: [
    { name: "phone-light", use: { ...phone, channel, colorScheme: "light" } },
    { name: "phone-dark", use: { ...phone, channel, colorScheme: "dark" } },
    { name: "mid-light", use: { viewport: SIZES.mid, hasTouch: true, channel, colorScheme: "light" } },
    { name: "wide-light", use: { viewport: SIZES.wide, channel, colorScheme: "light" } },
  ],
  webServer: {
    command: `pnpm run build && pnpm exec vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
