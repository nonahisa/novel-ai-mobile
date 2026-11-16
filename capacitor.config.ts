import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.nonahisa.novelai",
  appName: "統合小説執筆環境",
  webDir: "dist",
  /**
   * Capacitor の通信と部品の呼び出しの記録を出さない（既定の "debug" は、作り試しの版で、部品へ渡した物と
   * 返った物を WebView の記録・logcat に書く。GitHub の合言葉の答えや鍵の置き場の中身が入る。引継ぎ書 58章）
   */
  loggingBehavior: "none",
  android: {
    /**
     * 実機のWebViewを、パソコンのChromeから覗けるようにする（chrome://inspect）。
     * 縦書きや日本語入力の不具合は画面写真では分からないので、これが要る。
     * 配布時は false にする。
     */
    webContentsDebuggingEnabled: true,
  },
};

export default config;
