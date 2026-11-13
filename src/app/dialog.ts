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

/**
 * **画面の中に出す、字を1行打つ窓**（C 組んで書く の［ルビ］の読み。2026-11-13）。
 * ［決める］で打った字を、［やめる］・背景を押す・Esc で undefined を返す。
 * 変換を確定する Enter では決めない（`isComposing`。日本語入力で読みを打つため）
 */
export function askText(
  message: string,
  options: { initial?: string; okLabel?: string; cancelLabel?: string; note?: string; validate?: (value: string) => string | undefined } = {}
): Promise<string | undefined> {
  return new Promise((resolve) => {
    const backdrop = document.createElement("div");
    backdrop.className = "dialog-backdrop";
    backdrop.innerHTML =
      `<div class="dialog" role="dialog" aria-modal="true"><p class="dialog-message"></p>` +
      `<input class="dialog-input" id="dialogInput" type="text" lang="ja" autocomplete="off" />` +
      `<p class="dialog-note"></p>` +
      `<div class="dialog-actions"><button type="button" data-answer="no"></button><button type="button" class="primary" data-answer="yes"></button></div></div>`;
    backdrop.querySelector<HTMLElement>(".dialog-message")!.textContent = message;
    const input = backdrop.querySelector<HTMLInputElement>(".dialog-input")!;
    const note = backdrop.querySelector<HTMLElement>(".dialog-note")!;
    note.textContent = options.note ?? "";
    input.value = options.initial ?? "";
    input.setAttribute("aria-label", message);
    const yes = backdrop.querySelector<HTMLButtonElement>('[data-answer="yes"]')!;
    const no = backdrop.querySelector<HTMLButtonElement>('[data-answer="no"]')!;
    yes.textContent = options.okLabel ?? "決める";
    no.textContent = options.cancelLabel ?? "やめる";
    const close = (value: string | undefined) => {
      backdrop.remove();
      resolve(value);
    };
    const submit = () => {
      const problem = options.validate?.(input.value);
      if (problem) {
        note.textContent = problem;
        note.classList.add("warn");
        return;
      }
      close(input.value);
    };
    yes.addEventListener("click", submit);
    no.addEventListener("click", () => close(undefined));
    input.addEventListener("keydown", (e) => {
      if (e.isComposing) return;
      if (e.key === "Enter") {
        e.preventDefault();
        submit();
      } else if (e.key === "Escape") {
        close(undefined);
      }
    });
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) close(undefined);
    });
    document.body.appendChild(backdrop);
    input.focus({ preventScroll: true });
    input.select();
  });
}
