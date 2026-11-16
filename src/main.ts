import "./style.css";
import { App } from "@capacitor/app";
import { mountShell } from "./app/shell";
import { handleHardwareBack } from "./app/hardwareBack";

/**
 * モバイル版の入口。
 *
 * 下のタブ4つ（作品・書く・提案・ほか）と、予定している画面・メニューを並べる
 * （設計書 4.3・4.4 の【案】。作者の頼み 2026-11-07）。まだ作っていない項目は灰色で、
 * 押すと「まだ作っていません」と出る。作ってあるのは、縦書きの試し・すべての機能の一覧・
 * 動作確認ページ（［ほか］→ ヘルプ）。
 *
 * 中身は `src/app/`。端末で落ちる部品へ届いていないかは `test/androidReach.test.ts` が
 * この入口から静的 import をたどって見張る。
 */
mountShell(document.querySelector<HTMLDivElement>("#app")!);

/*
  端末の［戻る］キー（`src/app/hardwareBack.ts`）。App に聞き手を付けると、Capacitor は
  WebView の履歴を戻すのをやめ、聞き手へ知らせたうえで document に "backbutton" を送る。
  受けるのは document の側だけにする（2つで受けると1回の押しで2回戻る。画面の試験からも起こせる）
*/
void App.addListener("backButton", () => undefined).catch(() => undefined);
document.addEventListener("backbutton", () => {
  handleHardwareBack(document, () => void App.minimizeApp().catch(() => undefined));
});
