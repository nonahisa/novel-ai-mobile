import type { CapacitorConfig } from "@capacitor/cli";

const webViewDebug = process.env.NOVELAI_WEBVIEW_DEBUG === "1" && process.env.NOVELAI_RELEASE !== "1";

const config: CapacitorConfig = {
  appId: "com.nonahisa.novelai",
  appName: "統合小説執筆環境",
  webDir: "dist",
  /**
   * Capacitor の通信と部品の呼び出しの記録を出さない（既定の "debug" は、作り試しの版で、部品へ渡した物と
   * 返った物を WebView の記録・logcat に書く。GitHub の合言葉の答えや鍵の置き場の中身が入る。引継ぎ書 58章）
   */
  loggingBehavior: "none",
  /**
   * 実機の WebView を、パソコンの Chrome（chrome://inspect）や Mac の Safari から覗けるようにするか。
   * 縦書きや日本語入力の不具合を調べるときに要るが、覗けると中の localStorage・画面が読める（合言葉や AI の鍵を持つアプリ）。
   * **既定は閉じる**（2026-11-21 作者の答え。セキュリティチェックの 6）。調べるときだけ `NOVELAI_WEBVIEW_DEBUG=1` を付けて
   * 写す（`NOVELAI_WEBVIEW_DEBUG=1 pnpm run apk` など）。配る版の組み立て（`NOVELAI_RELEASE=1`）では付けても閉じる
   */
  android: {
    webContentsDebuggingEnabled: webViewDebug,
  },
  ios: {
    webContentsDebuggingEnabled: webViewDebug,
  },
};

export default config;
