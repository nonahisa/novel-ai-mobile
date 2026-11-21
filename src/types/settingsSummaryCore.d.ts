/**
 * 本体の `core/settingsSummary.ts`・`core/settingsMarkdown.ts` の、モバイル版が使う関数の形（型検査だけに使う。組み立てと
 * 試験は本体のファイルをそのまま使う。設定資料の画面 E。引継ぎ書 174章）。
 *
 * 本体の `settingsMarkdown.ts` に使っていない引数（`describeAbility` の `term`）があり、このアプリの型検査
 * （`noUnusedParameters`）を通らない。そこで `tsconfig.json` の `paths` で型検査のときだけここを読ませる（`writingStatsCore.d.ts`
 * と同じやり方）。**中身は写さない**（決まりは本体のまま）。形が変われば `test/workMaterials.test.ts` が落ちる
 */
import type { Character } from "novel-ai-assistant/src/models/character";
import type { Ability, AbilitySystem } from "novel-ai-assistant/src/models/ability";
import type { Location } from "novel-ai-assistant/src/models/location";
import type { Organization } from "novel-ai-assistant/src/models/organization";
import type { CustomFieldDefinition } from "novel-ai-assistant/src/models/customField";
import type { WorldItem } from "novel-ai-assistant/src/models/world";

export type SettingsKind = "character" | "ability" | "organization" | "location" | "world";
export const SETTINGS_KINDS: SettingsKind[];
export const KIND_LABELS: Record<SettingsKind, string>;
export function describeCharacter(
  character: Character,
  customFields?: CustomFieldDefinition[],
  options?: { omitChanges?: boolean; synopses?: readonly string[]; characters?: readonly Character[] }
): string;
export function describeAbility(ability: Ability, system?: AbilitySystem): string;
export function describeOrganization(organization: Organization, memberNames?: string[]): string;
export function describeLocation(location: Location): string;
export function describeWorldItem(item: WorldItem): string;
