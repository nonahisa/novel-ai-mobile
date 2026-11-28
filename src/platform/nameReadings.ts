import {
  expandNameVariants,
  nameReadingSpans,
  nameReadingsFrom,
  parseAbility,
  parseCharacter,
  parseLocation,
  parseOrganization,
  parseWorldItem,
  type ReadingSpan,
} from "../shared";
import type { FileStore } from "./fileStore";
import { readKind, type WorkTerms } from "./workTerms";

/**
 * **設定資料の名前の読みを読み上げに当てる**（本体の設計書 6.42.2。本体の `imeNameReadingSpans` の、設定資料の所）。
 *
 * 人物・能力・組織・場所・世界観の名前と別名に、資料に書いた読み（名前は `reading`、別名は `aliasReadings`）を当てる。
 * 並べ方・名前の広げ方（「マルキオ・イークェス」を「マルキオ」とも書く）・当てる決まり（漢字を含む2字以上だけ・長い名前から）は
 * 本体の `loadNameRecords`・`nameReadingsFrom`・`nameReadingSpans` と同じ。
 *
 * - **IME の読みの控えは使わない**。控えはパソコンごとで同期しない（本体の注記）ので、端末には届かない
 * - 読むだけ。壊れた1件は飛ばす（直さない）。読めなくても読み上げは止めない（呼ぶ側が空で続ける）
 */
export async function nameReadingSpansForWork(store: FileStore, settingsDir: string, text: string): Promise<ReadingSpan[]> {
  const errors: WorkTerms["errors"] = [];
  const [characters, abilities, organizations, locations, world] = await Promise.all([
    readKind(store, settingsDir, "characters", parseCharacter, errors),
    readKind(store, settingsDir, "abilities", parseAbility, errors),
    readKind(store, settingsDir, "organizations", parseOrganization, errors),
    readKind(store, settingsDir, "locations", parseLocation, errors),
    readKind(store, settingsDir, "world", parseWorldItem, errors),
  ]);
  const records = [...characters, ...abilities, ...organizations, ...locations, ...world].map((item) => ({
    name: item.name,
    aliases: expandNameVariants([item.name, ...item.aliases]).filter((variant) => variant !== item.name.trim()),
    reading: item.reading,
    ...(item.aliasReadings ? { aliasReadings: item.aliasReadings } : {}),
  }));
  return nameReadingSpans(text, nameReadingsFrom(records, new Map()));
}
