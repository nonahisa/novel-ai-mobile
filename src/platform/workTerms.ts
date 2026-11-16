import {
  expandNameVariants,
  parseAbility,
  parseCharacter,
  parseLocation,
  parseOrganization,
  type TermEntry,
} from "../shared";
import { FileNotFoundError, joinStorePath, type FileStore } from "./fileStore";

/**
 * **作品の設定資料から、用語の色の語を作る**（設計書 5.7。2026-11-17）。
 *
 * 語の作り方は本体の `TermHighlighter.load`（`views/termHighlight.ts`。vscode に頼るので借りられない）と同じにする。
 * 索引の作り方が食い違うと、色が付く語がパソコンとスマホで違ってしまう。
 *
 * - 人物（`設定/characters/`）：モブは除く（数が多く、地の文の普通名詞と重なりやすい）。名前と別名を
 *   `expandNameVariants` で広げる（「マルキオ・イークェス」→「マルキオ」も）
 * - 場所（`locations/`）：名前と別名を広げる
 * - 能力（`abilities/`）・組織（`organizations/`）：名前と別名をそのまま（「冒険者ギルド」を割らない）
 * - `_` で始まるファイル（`_index.json` など）と `.json` 以外は読まない。1件ずつ本体の検証（`parseCharacter` など）を
 *   通し、壊れた1件は飛ばして残りを読む（本体の `loadAll` と同じ。直さず、上書きもしない）
 * - フォルダーが無ければ、その種類は0件
 * - **シリーズでつないだ作品の語（本体の設計書 6.95.3）は、まだ読まない**（モバイル版はシリーズを持たない）
 *
 * ここは読むだけで、`設定/` へは書かない。
 */

export interface WorkTerms {
  entries: TermEntry[];
  /** 読めなかったファイル（`characters/c001.json` の形と訳）。作者に知らせる所はまだ無い */
  errors: Array<{ file: string; message: string }>;
}

type Named = { id: string; name: string; aliases: string[]; summary?: string | null };

async function readKind<T extends Named>(
  store: FileStore,
  settingsDir: string,
  directory: string,
  parse: (raw: unknown) => T,
  errors: WorkTerms["errors"]
): Promise<T[]> {
  const dir = joinStorePath(settingsDir, directory);
  let names: string[];
  try {
    names = await store.listFiles(dir);
  } catch (error) {
    if (error instanceof FileNotFoundError) return [];
    throw error;
  }
  const records: T[] = [];
  const seen = new Set<string>();
  for (const name of [...names].sort()) {
    if (!name.endsWith(".json") || name.startsWith("_")) continue;
    try {
      const raw: unknown = JSON.parse(new TextDecoder().decode(await store.readFile(joinStorePath(dir, name))));
      const record = parse(raw);
      if (name !== `${record.id}.json` && !name.startsWith(`${record.id}_`)) {
        throw new Error(`ファイル名とID「${record.id}」が一致しません。`);
      }
      if (seen.has(record.id)) throw new Error(`ID「${record.id}」が重複しています。`);
      seen.add(record.id);
      records.push(record);
    } catch (error) {
      errors.push({ file: `${directory}/${name}`, message: error instanceof Error ? error.message : String(error) });
    }
  }
  return records.sort((a, b) => a.id.localeCompare(b.id));
}

/** 作品の設定フォルダー（置き場の根から。`WorkLayout.settings`）の資料から、用語の色の語を作る */
export async function readWorkTerms(store: FileStore, settingsDir: string): Promise<WorkTerms> {
  const errors: WorkTerms["errors"] = [];
  const characters = await readKind(store, settingsDir, "characters", parseCharacter, errors);
  const locations = await readKind(store, settingsDir, "locations", parseLocation, errors);
  const abilities = await readKind(store, settingsDir, "abilities", parseAbility, errors);
  const organizations = await readKind(store, settingsDir, "organizations", parseOrganization, errors);

  const entries: TermEntry[] = [];
  const push = (text: string, kind: TermEntry["kind"], record: Named) =>
    entries.push({ text, kind, id: record.id, canonicalName: record.name, summary: record.summary ?? undefined });
  for (const character of characters) {
    if (character.isMob) continue;
    for (const text of expandNameVariants([character.name, ...character.aliases])) push(text, "character", character);
  }
  for (const location of locations) {
    for (const text of expandNameVariants([location.name, ...location.aliases])) push(text, "location", location);
  }
  for (const ability of abilities) {
    for (const text of [ability.name, ...ability.aliases]) push(text, "ability", ability);
  }
  for (const organization of organizations) {
    for (const text of [organization.name, ...organization.aliases]) push(text, "organization", organization);
  }
  return { entries, errors };
}
