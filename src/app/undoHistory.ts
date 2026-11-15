/**
 * **取り消し・やり直しの手の積み方**（設計書 5.5【案】）。
 *
 * 拡張機能は取り消しを VS Code の文書に任せていた。モバイル版には任せる先が無いので、アプリが本文を持ち、
 * 変わるたびに「変わった1か所」を手として積む。ブラウザの取り消し（`contenteditable` の履歴）は使わない
 * ——組み直すたびにブラウザの履歴は壊れるためである。
 *
 * - 手は本文（記法の字）の上の「start から removed を消し、inserted を入れた」で持つ。塊（ルビ・傍点）も
 *   記法の字のまま戻すので、戻した本文はいつも記法として正しい
 * - 続けて打った字（間が {@link MERGE_MS} ミリ秒より短く、続いた所に入った）は1手にまとめる。続けて ⌫ で
 *   消した字も同じ。改行・貼り付け・ルビ・傍点はいつも1手
 * - 取り消したあとに新しく打つと、やり直しの手は捨てる
 * - 手は {@link MAX_STEPS} まで持ち、古いものから捨てる
 */

export interface EditStep {
  start: number;
  removed: string;
  inserted: string;
  /** "type" は打った字・⌫ の1字消し（まとめてよい）。"other" は改行・貼り付け・ルビ・傍点など */
  kind: "type" | "other";
  at: number;
}

export const MERGE_MS = 1000;
export const MAX_STEPS = 500;

/** 前と後の本文の、変わった1か所（同じなら undefined） */
export function diffStep(before: string, after: string): Pick<EditStep, "start" | "removed" | "inserted"> | undefined {
  if (before === after) return undefined;
  let head = 0;
  const limit = Math.min(before.length, after.length);
  while (head < limit && before[head] === after[head]) head++;
  let tail = 0;
  while (tail < limit - head && before[before.length - 1 - tail] === after[after.length - 1 - tail]) tail++;
  return { start: head, removed: before.slice(head, before.length - tail), inserted: after.slice(head, after.length - tail) };
}

/** 本文に手を当てる（start から removed を inserted に替える） */
function apply(text: string, start: number, removed: string, inserted: string): string {
  return text.slice(0, start) + inserted + text.slice(start + removed.length);
}

/** 新しい手を前の手にまとめられるか */
function canMerge(prev: EditStep, next: EditStep): boolean {
  if (prev.kind !== "type" || next.kind !== "type") return false;
  if (next.at - prev.at >= MERGE_MS) return false;
  if (/\n/.test(prev.inserted + next.inserted)) return false;
  // 続けて打った：前の手で入れた字のすぐ後に入れた
  if (next.removed === "" && next.start === prev.start + prev.inserted.length) return true;
  // 続けて ⌫：前の手で消した所のすぐ前を消した
  if (prev.inserted === "" && next.inserted === "" && next.start + next.removed.length === prev.start) return true;
  return false;
}

export class UndoHistory {
  private done: EditStep[] = [];
  private undone: EditStep[] = [];

  /** before から after へ変わったことを積む。変わっていなければ何もしない */
  record(before: string, after: string, kind: EditStep["kind"], at: number): void {
    const diff = diffStep(before, after);
    if (!diff) return;
    const step: EditStep = { ...diff, kind, at };
    this.undone = [];
    const prev = this.done[this.done.length - 1];
    if (prev && canMerge(prev, step)) {
      this.done[this.done.length - 1] =
        step.removed === ""
          ? { ...prev, inserted: prev.inserted + step.inserted, at }
          : { ...prev, start: step.start, removed: step.removed + prev.removed, at };
      return;
    }
    this.done.push(step);
    if (this.done.length > MAX_STEPS) this.done.shift();
  }

  /** 1手戻す。戻した本文と、カーソルを置く所（戻した字のすぐ後） */
  undo(text: string): { text: string; caret: number } | undefined {
    const step = this.done.pop();
    if (!step) return undefined;
    // 手と本文が合わなければ（よそで本文が替わった）、戻さずに手を捨てる
    if (text.slice(step.start, step.start + step.inserted.length) !== step.inserted) {
      this.clear();
      return undefined;
    }
    this.undone.push(step);
    return { text: apply(text, step.start, step.inserted, step.removed), caret: step.start + step.removed.length };
  }

  /** 戻した手をもう一度当てる */
  redo(text: string): { text: string; caret: number } | undefined {
    const step = this.undone.pop();
    if (!step) return undefined;
    if (text.slice(step.start, step.start + step.removed.length) !== step.removed) {
      this.clear();
      return undefined;
    }
    this.done.push(step);
    return { text: apply(text, step.start, step.removed, step.inserted), caret: step.start + step.inserted.length };
  }

  canUndo(): boolean {
    return this.done.length > 0;
  }

  canRedo(): boolean {
    return this.undone.length > 0;
  }

  clear(): void {
    this.done = [];
    this.undone = [];
  }
}
