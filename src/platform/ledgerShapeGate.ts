/**
 * **台帳の形の関所**（2026-11-21 昼 作者の答え「台帳の形が変わったときだけ止める」。2026-11-06 の決めごとを改めた。引継ぎ書 170章）。
 *
 * 作品フォルダーの台帳（作品の設定・章立て・各話あらすじ・投稿状態 など）は GitHub で同期し、本体とモバイル版が同じものを読み書きする。
 * モバイル版の知らない形の台帳を書き戻すと、本体で増えた欄を落として同期で消してしまう。そこで、**書く前に、その台帳の
 * 形の版（`schemaVersion`）を見る**：
 *
 * - モバイル版の取り込んだ本体の部品が知っている版（`CHAPTERS_SCHEMA_VERSION` など）**より新しい**ときだけ、その台帳を書かない
 * - 同じ・古い・書かれていない（古い作品）ときは書く（読み替えは本体の部品がする）
 * - 数として読めない版（"2a" など）も、知らない形として書かない
 * - 読むのは止めない。本文も止めない
 *
 * 11-06 の決めごと（本体の最新のタグがモバイル版の取り込んだ版より新しい間は、台帳を書く機能を全部止める）は、
 * 台帳の形が変わっていない版上げでも止まるので改めた（`sharedVersionGate.ts` は、動作確認ページで最新のタグを見せるだけに残す）。
 * プロット（`plot.md`）は作者の Markdown で形の版を持たないので、ここでは見ない（書く口は節だけを差し替える）
 */

/** "0.2" と "0.10" を数として比べる（左が新しければ正） */
export function compareSchemaVersions(a: string, b: string): number {
  const left = a.split(".").map(Number);
  const right = b.split(".").map(Number);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

const NUMERIC_VERSION = /^\d+(\.\d+)*$/;

/**
 * 書いてよいか。だめなら作者に見せる理由、よければ undefined。
 *
 * @param label 作者に見せる台帳の呼び名（「章立て」など）
 * @param written 台帳の中身（JSON の文字）。まだ無い・壊れている（壊れたものは書く口が別に止める）なら見ない
 * @param known モバイル版の取り込んだ本体の部品が知っている形の版
 */
export function ledgerShapeProblem(label: string, written: string | undefined, known: string | number): string | undefined {
  if (written === undefined) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(written);
  } catch {
    return undefined;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const raw = (value as { schemaVersion?: unknown }).schemaVersion;
  if (raw === undefined || raw === null || raw === "") return undefined;
  const version = String(raw).trim();
  if (NUMERIC_VERSION.test(version) && compareSchemaVersions(version, String(known)) <= 0) return undefined;
  return (
    `${label}の形が新しくなっています（形の版 ${version}。モバイル版は ${known} まで）。` +
    "本体で増えた欄を消さないよう、モバイル版を新しくするまで、この台帳は書きません。本文は書けます"
  );
}
