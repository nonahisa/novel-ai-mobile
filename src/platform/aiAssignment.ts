import {
  ASSIGNABLE_FEATURES,
  ASSIGNABLE_FEATURE_LABELS,
  decideFeatureAI,
  withAssignment,
  withoutAssignment,
  type AssignableFeature,
  type FeatureAssignment,
  type FeatureAssignments,
} from "../shared";
import { CLOUD_PROVIDERS, type CloudProviderId } from "./aiKeys";
import type { DeviceSettings } from "./deviceSettings";

/**
 * **機能ごとの AI の割り当て**（共通設計書 4.2〜4.3・設計書 7章。母艦の指示 2026-11-16 の B-2。引継ぎ書 74章）。
 *
 * - 型と決め方は本体の `core/featureAssignment.ts`（1.0.20 で vscode に頼らない部品に切り出された）をそのまま使う
 * - 置き場は端末の設定（設計書 8章「AI の選び方は端末の設定に置き、同期しない」）。名前は本体の globalState と同じ
 *   （`novelai.ai.featureAssignments`・`novelai.ai.provider`・`novelai.ai.model`）
 * - 割り当ての無い機能は既定の AI。割り当てた AI が使えない（鍵を消した）ときも既定へ落とす（本体の `decideFeatureAI`）
 * - 選べる AI はいまはクラウドの4つ。手元の AI（Ollama・LM Studio。Tailscale の道だけ）は段2で足す
 */

export const ASSIGNMENTS_KEY = "novelai.ai.featureAssignments";
export const DEFAULT_PROVIDER_KEY = "novelai.ai.provider";
export const DEFAULT_MODEL_KEY = "novelai.ai.model";

export type Assignments = FeatureAssignments<CloudProviderId>;
export interface DefaultChoice {
  provider: CloudProviderId | undefined;
  model: string | undefined;
}

const isProvider = (value: unknown): value is CloudProviderId => CLOUD_PROVIDERS.some((provider) => provider.id === value);

/** 端末の設定から読む。知らない AI・形の崩れた割り当ては読まない（無かったことにする。書き戻さない） */
export function readAiChoices(settings: DeviceSettings): { assignments: Assignments; defaultChoice: DefaultChoice } {
  const raw = settings.get<Record<string, unknown>>(ASSIGNMENTS_KEY, {}) ?? {};
  const assignments: Assignments = {};
  for (const feature of ASSIGNABLE_FEATURES) {
    const value = (raw as Record<string, unknown>)[feature] as Partial<FeatureAssignment> | undefined;
    if (value && isProvider(value.provider) && typeof value.model === "string" && value.model !== "") {
      assignments[feature] = { provider: value.provider, model: value.model };
    }
  }
  const provider = settings.get<unknown>(DEFAULT_PROVIDER_KEY);
  const model = settings.get<unknown>(DEFAULT_MODEL_KEY);
  return {
    assignments,
    defaultChoice: { provider: isProvider(provider) ? provider : undefined, model: typeof model === "string" && model !== "" ? model : undefined },
  };
}

export async function saveFeatureChoice(
  settings: DeviceSettings,
  current: Assignments,
  feature: AssignableFeature,
  choice: FeatureAssignment<CloudProviderId> | undefined
): Promise<Assignments> {
  const next = choice ? withAssignment(current, feature, choice.provider, choice.model) : withoutAssignment(current, feature);
  await settings.update(ASSIGNMENTS_KEY, next);
  return next;
}

export async function saveDefaultChoice(settings: DeviceSettings, choice: FeatureAssignment<CloudProviderId>): Promise<void> {
  await settings.update(DEFAULT_PROVIDER_KEY, choice.provider);
  await settings.update(DEFAULT_MODEL_KEY, choice.model);
}

/** 「Claude・claude-x」 */
export function describeChoice(choice: { provider: CloudProviderId; model: string }): string {
  const provider = CLOUD_PROVIDERS.find((candidate) => candidate.id === choice.provider);
  return `${provider?.keyName ?? choice.provider}・${choice.model}`;
}

export interface FeatureRow {
  feature: AssignableFeature;
  label: string;
  /** 割り当てた AI（無ければ既定のまま） */
  assigned?: string;
  /** 割り当てた AI の鍵が無いので、既定で動く */
  fellBack: boolean;
}

/** 機能ごとの行（並びと名前は本体のまま。実際に使う AI は本体の `decideFeatureAI` で決める） */
export function featureRows(assignments: Assignments, defaultChoice: DefaultChoice, usable: ReadonlySet<CloudProviderId>): FeatureRow[] {
  return ASSIGNABLE_FEATURES.map((feature) => {
    const assigned = assignments[feature];
    const decision = decideFeatureAI(feature, assignments, defaultChoice, (provider) => usable.has(provider));
    return {
      feature,
      label: ASSIGNABLE_FEATURE_LABELS[feature],
      ...(assigned ? { assigned: describeChoice(assigned) } : {}),
      fellBack: decision.fellBackFrom !== undefined,
    };
  });
}

/** 有料の AI を割り当てたときの知らせ（本体 `assignFeatureAI.ts` と同じ字） */
export const PAID_ASSIGN_NOTICE = "実行のたびに課金されます（実行前に目安を表示します）。";
