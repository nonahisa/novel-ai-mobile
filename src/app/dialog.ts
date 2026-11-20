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
  options: {
    initial?: string;
    okLabel?: string;
    cancelLabel?: string;
    note?: string;
    validate?: (value: string) => string | undefined;
    /** 打った字を伏せる（API キー。画面に出さない・端末の予測や控えに残さない） */
    password?: boolean;
    placeholder?: string;
  } = {}
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
    if (options.password) {
      input.type = "password";
      input.setAttribute("autocapitalize", "off");
      input.setAttribute("spellcheck", "false");
      input.removeAttribute("lang");
    }
    if (options.placeholder) input.placeholder = options.placeholder;
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

/**
 * **画面の中に出す、知らせるだけの窓**（ボタン1つ。自動保存が止まった・保存できなかったとき。
 * 2026-11-15 作者の答え「その場で真ん中の窓」）。閉じたら解ける
 */
export function tell(message: string, okLabel = "閉じる"): Promise<void> {
  return new Promise((resolve) => {
    const backdrop = document.createElement("div");
    backdrop.className = "dialog-backdrop";
    backdrop.innerHTML = `<div class="dialog" role="alertdialog" aria-modal="true"><p class="dialog-message"></p><div class="dialog-actions"><button type="button" class="primary" data-answer="ok"></button></div></div>`;
    backdrop.querySelector<HTMLElement>(".dialog-message")!.textContent = message;
    const ok = backdrop.querySelector<HTMLButtonElement>('[data-answer="ok"]')!;
    ok.textContent = okLabel;
    const close = () => {
      backdrop.remove();
      resolve();
    };
    ok.addEventListener("click", close);
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) close();
    });
    document.body.appendChild(backdrop);
    ok.focus({ preventScroll: true });
  });
}

/**
 * **画面の中に出す、いくつかから1つ選ぶ窓**（［作品］の［＋］の「GitHub から取り寄せる／新しく作る」。設計書 4.4.3）。
 * 選んだものの `id` を返す。［やめる］・背景を押す・端末の［戻る］（`data-answer="no"`）は undefined。
 * まだ作っていないもの（`planned`）は灰色の「未」で出し、選ぶと `id` を返す（呼ぶ側が「まだ作っていません」と知らせる）
 */
export function chooseFrom(
  options: readonly { id: string; label: string; planned?: boolean }[],
  cancelLabel = "やめる"
): Promise<string | undefined> {
  return new Promise((resolve) => {
    const backdrop = document.createElement("div");
    backdrop.className = "dialog-backdrop";
    backdrop.innerHTML = `<div class="dialog dialog-choices" role="dialog" aria-modal="true"><div class="dialog-list"></div><div class="dialog-actions"><button type="button" data-answer="no"></button></div></div>`;
    const list = backdrop.querySelector<HTMLElement>(".dialog-list")!;
    for (const option of options) {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.choice = option.id;
      button.textContent = option.label;
      if (option.planned) {
        button.classList.add("planned");
        const badge = document.createElement("span");
        badge.className = "menu-badge";
        badge.textContent = "未";
        button.appendChild(badge);
      }
      list.appendChild(button);
    }
    const no = backdrop.querySelector<HTMLButtonElement>('[data-answer="no"]')!;
    no.textContent = cancelLabel;
    const close = (value: string | undefined) => {
      backdrop.remove();
      resolve(value);
    };
    list.addEventListener("click", (e) => {
      const target = (e.target as HTMLElement).closest<HTMLElement>("[data-choice]");
      if (target) close(target.dataset.choice);
    });
    no.addEventListener("click", () => close(undefined));
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) close(undefined);
    });
    document.body.appendChild(backdrop);
    no.focus({ preventScroll: true });
  });
}

/**
 * **画面の中に出す、いくつか選ぶ窓**（作品の長押しの［シリーズ］で、つなぐ作品を選ぶ。2026-11-20 夜）。
 * 印を付けたものの `id` を並べて返す（何も付けなければ空の並び＝「全部外す」）。［やめる］・背景を押すと undefined
 */
export function chooseMany(
  message: string,
  options: readonly { id: string; label: string; checked?: boolean }[],
  okLabel = "決める",
  cancelLabel = "やめる"
): Promise<string[] | undefined> {
  return new Promise((resolve) => {
    const backdrop = document.createElement("div");
    backdrop.className = "dialog-backdrop";
    backdrop.innerHTML = `<div class="dialog dialog-many" role="dialog" aria-modal="true"><p class="dialog-message"></p><div class="dialog-list"></div><div class="dialog-actions"><button type="button" data-answer="no"></button><button type="button" class="primary" data-answer="yes"></button></div></div>`;
    backdrop.querySelector<HTMLElement>(".dialog-message")!.textContent = message;
    const list = backdrop.querySelector<HTMLElement>(".dialog-list")!;
    for (const option of options) {
      const label = document.createElement("label");
      label.className = "dialog-check";
      const box = document.createElement("input");
      box.type = "checkbox";
      box.value = option.id;
      box.checked = option.checked === true;
      const text = document.createElement("span");
      text.textContent = option.label;
      label.append(box, text);
      list.appendChild(label);
    }
    const yes = backdrop.querySelector<HTMLButtonElement>('[data-answer="yes"]')!;
    const no = backdrop.querySelector<HTMLButtonElement>('[data-answer="no"]')!;
    yes.textContent = okLabel;
    no.textContent = cancelLabel;
    const close = (value: string[] | undefined) => {
      backdrop.remove();
      resolve(value);
    };
    yes.addEventListener("click", () => close([...list.querySelectorAll<HTMLInputElement>("input:checked")].map((box) => box.value)));
    no.addEventListener("click", () => close(undefined));
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) close(undefined);
    });
    document.body.appendChild(backdrop);
    no.focus({ preventScroll: true });
  });
}
