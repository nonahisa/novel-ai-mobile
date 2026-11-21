import {
  expandNameVariants,
  isPlainFolderName,
  isShareableRecord,
  parseAbility,
  parseSeriesConfig,
  seriesSourceTitle,
  parseCharacter,
  parseLocation,
  parseOrganization,
  type TermEntry,
} from "../shared";
import { FileNotFoundError, joinStorePath, normalizeStorePath, type FileStore } from "./fileStore";
import { readWorkLayout } from "./workScan";
import { AIWRITER_DIR, CONFIG_FILE } from "../shared";

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
 * - シリーズでつないだ作品の語（本体の設計書 6.95.3）は {@link readSeriesTerms} で別に読み、自分の語の後ろに足す
 *
 * ここは読むだけで、`設定/` へは書かない。
 */

export interface WorkTerms {
  entries: TermEntry[];
  /** 読めなかったファイル（`characters/c001.json` の形と訳）。作者に知らせる所はまだ無い */
  errors: Array<{ file: string; message: string }>;
}

type Named = { id: string; name: string; aliases: string[]; summary?: string | null };

/**
 * 設定フォルダーの1種類（`characters` など）を、本体の検証を通して読む。壊れた1件は `errors` へ積んで飛ばす。
 * 用語の色と設定資料の画面（`workMaterials.ts`）で同じ読み方にする
 */
export async function readKind<T extends { id: string }>(
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

/**
 * **シリーズでつないだ作品の語**（本体の設計書 6.95.3・`core/seriesSettings.ts` の `loadSeriesTerms`。vscode に頼るので
 * 借りられず、同じ作りで写した。判断の部品 `core/seriesLink.ts` は本体のものをそのまま使う）。
 *
 * - 相手は作品の `config.json` の `series.related` に書いたフォルダー名だけ。**自分と同じ親フォルダーの下の隣**としてしか
 *   指せない（`..` や区切りを含む名前・自分自身は読まない。本体の `parseSeriesConfig`・`resolveRelatedWorkPaths` と同じ）
 * - 借りるのは**名前と別名だけ**。関門は本体の `isShareableRecord`（公開・登場済みだけ。欄が欠けたら読まない）。モブは
 *   借りない。名前は広げない（本体の `loadTermsFrom` と同じ）
 * - 札の紹介は相手の中身でなく「〈相手の題〉にも出てきます」（本体の `TermHighlighter` と同じ文）。id は `series:` で始め、
 *   自分のレコードと混ざらないようにする
 * - 相手が無い・設定が無い・壊れている：その1件や1作品を飛ばして進む（味付けなので止めない）。相手へは書かない
 */
export async function readSeriesTerms(store: FileStore, workRoot: string): Promise<TermEntry[]> {
  const root = normalizeStorePath(workRoot);
  let series;
  try {
    const raw: unknown = JSON.parse(new TextDecoder().decode(await store.readFile(joinStorePath(root, AIWRITER_DIR, CONFIG_FILE))));
    series = parseSeriesConfig(typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>).series : undefined);
  } catch {
    return [];
  }
  if (!series) return [];
  const parts = root.split("/");
  const selfName = parts.pop() ?? "";
  const parent = parts.join("/");

  const entries: TermEntry[] = [];
  const seen = new Set<string>();
  for (const folderName of series.related) {
    if (!isPlainFolderName(folderName) || folderName === selfName || seen.has(folderName)) continue;
    seen.add(folderName);
    const neighbor = joinStorePath(parent, folderName);
    try {
      await store.listEntries(neighbor);
    } catch {
      continue; // 相手が見つからないときは、黙って何もしない（本体の 6.95.2）
    }
    let settings: string;
    let title: string | undefined;
    try {
      const layout = await readWorkLayout(store, neighbor);
      settings = layout.settings;
      title = layout.title;
    } catch {
      continue;
    }
    const sourceTitle = seriesSourceTitle(folderName, title);
    const ignored: WorkTerms["errors"] = [];
    const push = (kind: TermEntry["kind"], record: Named & { spoilerLevel?: unknown; status?: unknown; isMob?: boolean }) => {
      if (!isShareableRecord(record) || record.isMob) return;
      const name = record.name.trim();
      if (!name) return;
      const entry = (text: string) =>
        entries.push({ text, kind, id: `series:${kind}:${name}`, canonicalName: name, summary: `${sourceTitle}にも出てきます` });
      entry(name);
      for (const alias of record.aliases) {
        const trimmed = alias.trim();
        if (trimmed && trimmed !== name) entry(trimmed);
      }
    };
    const kinds = [
      ["character", "characters", parseCharacter],
      ["location", "locations", parseLocation],
      ["ability", "abilities", parseAbility],
      ["organization", "organizations", parseOrganization],
    ] as const;
    for (const [kind, directory, parse] of kinds) {
      try {
        for (const record of await readKind<Named>(store, settings, directory, parse, ignored)) push(kind, record);
      } catch {
        // その種類ごと読めないときも、飛ばして進む
      }
    }
  }
  return entries;
}
