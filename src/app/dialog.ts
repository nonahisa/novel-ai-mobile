/**
 * **画面の中に出す、日本語のボタンの確認**（2026-11-07 Mac：`window.confirm` は、ボタンが端末の
 * 言葉（iOS のシミュレーターでは Cancel／OK）になる。作者には［保存しないで戻る］［とどまる］のように、
 * 何が起きるかが分かる日本語のボタンで訊く）。
 *
 * 答えは Promise で返す（`window.confirm` と違い、待つあいだ画面は止まらない）。
 * 背景を押したときと［とどまる］側は「いいえ」。いちばんに焦点を置くのも「いいえ」（押し間違いで捨てない）。
 */
export function askChoice(message: string, yesLabel: string, noLabel: string): Promise<boolean> {
  return new Promise((resolve) => {
    const backdrop = document.createElement("div");
    backdrop.className = "dialog-backdrop";
    backdrop.innerHTML = `<div class="dialog" role="alertdialog" aria-modal="true"><p class="dialog-message"></p><div class="dialog-actions"><button type="button" data-answer="no"></button><button type="button" class="danger" data-answer="yes"></button></div></div>`;
    backdrop.querySelector<HTMLElement>(".dialog-message")!.textContent = message;
    const yes = backdrop.querySelector<HTMLButtonElement>('[data-answer="yes"]')!;
    const no = backdrop.querySelector<HTMLButtonElement>('[data-answer="no"]')!;
    yes.textContent = yesLabel;
    no.textContent = noLabel;
    const answer = (value: boolean) => {
      backdrop.remove();
      resolve(value);
    };
    yes.addEventListener("click", () => answer(true));
    no.addEventListener("click", () => answer(false));
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) answer(false);
    });
    document.body.appendChild(backdrop);
    no.focus({ preventScroll: true });
  });
}
