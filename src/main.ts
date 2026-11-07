import "./style.css";
import { mountShell } from "./app/shell";

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
