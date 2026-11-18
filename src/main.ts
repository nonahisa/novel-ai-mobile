import "./style.css";
import "./looks.css";
import { App } from "@capacitor/app";
import { mountShell } from "./app/shell";
import { handleHardwareBack } from "./app/hardwareBack";
import { Capacitor } from "@capacitor/core";
import { Keyboard } from "@capacitor/keyboard";
import { watchCompact } from "./app/compactMode";
import { applyLook, readLook } from "./app/look";
import { applyBodyFont, applyBodySize, readBodyFont, readBodySize } from "./app/bodyFont";

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

/* キーボードが出て見える所が低いときは、上下を細くする（`src/app/compactMode.ts`。2026-11-17 作者の答え） */
watchCompact(window, document.documentElement);
// 見た目の案（設定 → 表示 → 見た目。端末ごとに覚える）
applyLook(document.documentElement, readLook(globalThis.localStorage));
applyBodyFont(document.documentElement, readBodyFont(globalThis.localStorage));
applyBodySize(document.documentElement, readBodySize(globalThis.localStorage));
/*
  iPad だけ、キーボードの上の「完了」などの帯を消す（同じ答え。横向きで約40pt 広がる）。iPhone は消さない：
  iPhone のキーボードには閉じるキーが無く、帯の「完了」でしか閉じられない。iPad の名乗りは「Macintosh」なので、
  「iPhone」を含まない iOS を iPad とみなす
*/
if (Capacitor.getPlatform() === "ios" && !/iPhone|iPod/.test(navigator.userAgent)) {
  void Keyboard.setAccessoryBarVisible({ isVisible: false }).catch(() => undefined);
}
