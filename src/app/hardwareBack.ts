/**
 * **端末の［戻る］キー**（Android の戻るボタン・戻る身ぶり。設計書 4.3）。
 *
 * 押したときは、画面の中で押すのと同じ道を通す（別の戻り方を作らない）。
 *
 * 1. 真ん中の窓が出ていれば、窓を閉じる側（［とどまる］［やめる］［閉じる］）を押す。捨てる側は押さない
 * 1b. 色の付いた名前の資料（`.term-sheet`。設計書 5.7）が出ていれば、それを閉じる（原稿は離れない）
 * 2. 上のバーに［←］があれば、それを押す（原稿エディターなら保存を済ませてから話の一覧へ。`shell.ts`）
 * 3. 下のタブの［作品］以外にいれば、［作品］へ
 * 4. ［作品］にいれば、アプリを裏へ回す（閉じない。書きかけの控えや自動保存は裏へ回るときに済ませる）
 *
 * Capacitor の App は、聞き手を付けないと WebView の履歴を戻すだけで、
 * ［←］が `location.replace` で移る作りと食い違い、戻らないことがあった（2026-11-16 エミュレーター）。
 * 配線は `main.ts`
 */
export type HardwareBackAction = "dialog" | "sheet" | "back" | "home" | "minimize";

export function hardwareBackAction(doc: Document, hash: string): HardwareBackAction {
  if (doc.querySelector(".dialog-backdrop")) return "dialog";
  if (doc.querySelector(".term-sheet:not([hidden])")) return "sheet";
  if (doc.querySelector(".appbar-back")) return "back";
  const tab = hash.replace(/^#\/?/, "");
  return tab === "" || tab === "works" ? "minimize" : "home";
}

export function handleHardwareBack(doc: Document, minimize: () => void): HardwareBackAction {
  const action = hardwareBackAction(doc, doc.location?.hash ?? "");
  switch (action) {
    case "dialog": {
      const dialogs = doc.querySelectorAll<HTMLElement>(".dialog-backdrop");
      const top = dialogs[dialogs.length - 1]!;
      (top.querySelector<HTMLElement>('[data-answer="no"]') ?? top.querySelector<HTMLElement>('[data-answer="ok"]'))?.click();
      break;
    }
    case "sheet":
      doc.querySelector<HTMLElement>(".term-sheet:not([hidden]) #termSheetClose")?.click();
      break;
    case "back":
      doc.querySelector<HTMLElement>(".appbar-back")!.click();
      break;
    case "home":
      doc.location.replace("#/works");
      break;
    case "minimize":
      minimize();
      break;
  }
  return action;
}
