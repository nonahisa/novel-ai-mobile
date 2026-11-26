import type { FileStore } from "../platform/fileStore";
import { changedValues, editFieldsOf, saveMaterialEdits, type EditField } from "../platform/materialEdit";
import { isEnrichKind, readRecordFile, type RecordFile } from "../platform/materialEnrich";
import { readWorkLayout } from "../platform/workScan";
import { escapeHtml, renderAppBar } from "./menuScreen";

/**
 * **設定資料の1件を手で直す画面**（`#/materials/<作品>/<種類>/<id>/edit`。2026-11-27 作者の答え「全部の欄」）。
 * 欄と反映の決まりは `platform/materialEdit.ts`（本体の設定資料パネルと同じ）。［保存］で変えた欄だけを書き、1件へ戻る。
 * 保存していない書き換えがあるまま離れようとしたら、ほかの画面と同じく訊く（`isDirty`）
 */

export interface MaterialEditDeps {
  store: FileStore;
  root: string;
  kind: string;
  id: string;
  toast: (text: string) => void;
  stillHere: () => boolean;
  /** 書く直前に、その道をアプリが書いた控えへ（`touchedPaths.ts`） */
  beforeWrite?: (path: string) => Promise<void>;
  /** 保存したあと・［やめる］で戻る所（1件の画面） */
  done: () => void;
  now?: () => string;
}

export function renderEditForm(fields: readonly EditField[]): string {
  const rows = fields
    .map((field, index) => {
      const id = `editField${index}`;
      const hint = field.hint ? `<p class="enrich-note">${escapeHtml(field.hint)}</p>` : "";
      if (field.check) {
        return (
          `<div class="edit-field edit-check" data-key="${escapeHtml(field.key)}"><label class="enrich-pick">` +
          `<input type="checkbox" class="enrich-check edit-input"${field.value === "1" ? " checked" : ""}><span>${escapeHtml(field.label)}</span></label>${hint}</div>`
        );
      }
      const label = `<label class="edit-label" for="${id}">${escapeHtml(field.label)}</label>`;
      const input = field.choices
        ? `<select id="${id}" class="edit-input">${field.choices
            .map((choice) => `<option value="${escapeHtml(choice.value)}"${choice.value === field.value ? " selected" : ""}>${escapeHtml(choice.label)}</option>`)
            .join("")}</select>`
        : field.multiline
          ? `<textarea id="${id}" class="edit-input" rows="${Math.min(8, Math.max(3, field.value.split("\n").length + 1))}">${escapeHtml(field.value)}</textarea>`
          : `<input id="${id}" class="edit-input" type="text" value="${escapeHtml(field.value)}">`;
      return `<div class="edit-field" data-key="${escapeHtml(field.key)}">${label}${hint}${input}</div>`;
    })
    .join("");
  return (
    `<p class="enrich-note">直した資料は「作者」の印が付き、AI の読み取りでは上書きされなくなります</p>` +
    `<div class="edit-fields">${rows}</div>` +
    `<p class="sync-result" id="editProgress" role="status"></p>` +
    `<div class="draft-actions"><button class="primary" id="editSave">保存</button><button id="editCancel">やめる</button></div>`
  );
}

/** 画面のいまの値（チェックは "1" か ""） */
export function currentValues(container: HTMLElement): Record<string, string> {
  const values: Record<string, string> = {};
  container.querySelectorAll<HTMLElement>(".edit-field").forEach((row) => {
    const input = row.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(".edit-input");
    if (!input || row.dataset.key === undefined) return;
    values[row.dataset.key] = input instanceof HTMLInputElement && input.type === "checkbox" ? (input.checked ? "1" : "") : input.value;
  });
  return values;
}

export function mountMaterialEdit(screen: HTMLElement, deps: MaterialEditDeps): { isDirty: () => boolean; destroy: () => void } {
  screen.innerHTML = `${renderAppBar("資料を直す", { back: true })}<div class="enrich" id="editSlot" aria-busy="true"></div>`;
  const slot = screen.querySelector<HTMLElement>("#editSlot")!;
  const now = deps.now ?? (() => new Date().toISOString());
  let fields: EditField[] = [];
  let saved = false;
  const fail = (message: string) => {
    if (!deps.stillHere()) return;
    slot.removeAttribute("aria-busy");
    slot.innerHTML = `<p class="flag shu long" id="editProblem">${escapeHtml(message)}</p>`;
  };
  void (async () => {
    if (!isEnrichKind(deps.kind)) return fail("この種類の資料は、ここでは直せません");
    let file: RecordFile | undefined;
    let settingsDir: string;
    try {
      settingsDir = (await readWorkLayout(deps.store, deps.root)).settings;
      file = await readRecordFile(deps.store, settingsDir, deps.kind, deps.id);
      if (file) fields = await editFieldsOf(deps.store, settingsDir, file);
    } catch (error) {
      return fail(error instanceof Error ? error.message : String(error));
    }
    if (!file) return fail("この資料は見つかりませんでした");
    if (!deps.stillHere()) return;
    const title = screen.querySelector<HTMLElement>(".appbar-title");
    if (title) title.textContent = `直す：${file.record.name}`;
    slot.removeAttribute("aria-busy");
    slot.innerHTML = renderEditForm(fields);
    const target = file;
    const save = slot.querySelector<HTMLButtonElement>("#editSave")!;
    const progress = slot.querySelector<HTMLElement>("#editProgress")!;
    slot.querySelector<HTMLButtonElement>("#editCancel")!.addEventListener("click", () => deps.done());
    save.addEventListener("click", () => {
      void (async () => {
        const changed = changedValues(fields, currentValues(slot));
        if (Object.keys(changed).length === 0) return deps.toast("変えた欄がありません");
        save.disabled = true;
        let result;
        try {
          result = await saveMaterialEdits(deps.store, settingsDir, target, changed, now(), deps.beforeWrite);
        } catch (error) {
          result = { ok: false as const, notice: error instanceof Error ? error.message : String(error) };
        }
        if (!deps.stillHere()) return;
        if (!result.ok) {
          save.disabled = false;
          progress.textContent = result.notice;
          return;
        }
        saved = true;
        deps.toast(result.notice);
        deps.done();
      })();
    });
  })();
  return {
    isDirty: () => !saved && fields.length > 0 && Object.keys(changedValues(fields, currentValues(slot))).length > 0,
    destroy: () => undefined,
  };
}
