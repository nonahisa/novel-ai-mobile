import { describe, expect, test } from "vitest";
import { DeviceSettings, type SettingsBackend } from "../src/platform/deviceSettings";
import {
  ASSIGNMENTS_KEY,
  DEFAULT_MODEL_KEY,
  DEFAULT_PROVIDER_KEY,
  describeChoice,
  featureRows,
  readAiChoices,
  saveDefaultChoice,
  saveFeatureChoice,
} from "../src/platform/aiAssignment";
import { renderFeatureRows } from "../src/app/aiScreen";

/** 機能ごとの AI の割り当て（`src/platform/aiAssignment.ts`。本体の featureAssignment を使う。引継ぎ書 74章） */

function memoryBackend(initial: Record<string, unknown> = {}): SettingsBackend & { store: Map<string, string> } {
  const store = new Map(Object.entries(initial).map(([k, v]) => [k, JSON.stringify(v)]));
  return { store, keys: async () => [...store.keys()], get: async (k) => store.get(k) ?? null, set: async (k, v) => void store.set(k, v) };
}

describe("割り当ての読み書き", () => {
  test("名前は本体の globalState と同じ。知らない AI・崩れた割り当ては読まない（書き戻さない）", async () => {
    const backend = memoryBackend({
      [ASSIGNMENTS_KEY]: { typo: { provider: "claude", model: "m1" }, proofread: { provider: "ollama", model: "x" }, chat: { provider: "openai" } },
      [DEFAULT_PROVIDER_KEY]: "gemini",
      [DEFAULT_MODEL_KEY]: "g1",
    });
    const { settings } = await DeviceSettings.load(backend);
    expect(readAiChoices(settings)).toEqual({ assignments: { typo: { provider: "claude", model: "m1" } }, defaultChoice: { provider: "gemini", model: "g1" } });
    expect(JSON.parse(backend.store.get(ASSIGNMENTS_KEY)!).proofread).toEqual({ provider: "ollama", model: "x" });
  });

  test("機能に割り当てる・外す（既定のまま）。既定の AI を選ぶ", async () => {
    const backend = memoryBackend();
    const { settings } = await DeviceSettings.load(backend);
    let assignments = await saveFeatureChoice(settings, {}, "typo", { provider: "claude", model: "m1" });
    expect(readAiChoices(settings).assignments).toEqual({ typo: { provider: "claude", model: "m1" } });
    assignments = await saveFeatureChoice(settings, assignments, "typo", undefined);
    expect(readAiChoices(settings).assignments).toEqual({});
    await saveDefaultChoice(settings, { provider: "openai", model: "gpt" });
    expect(readAiChoices(settings).defaultChoice).toEqual({ provider: "openai", model: "gpt" });
    expect(JSON.parse(backend.store.get(DEFAULT_PROVIDER_KEY)!)).toBe("openai");
  });
});

test("機能の行：本体の12機能の並びと名前。割り当てた AI の鍵が無ければ既定で動くと出す", () => {
  const rows = featureRows({ typo: { provider: "claude", model: "m1" }, chat: { provider: "openai", model: "gpt" } }, { provider: "gemini", model: "g" }, new Set(["claude", "gemini"]));
  expect(rows).toHaveLength(12);
  expect(rows[0]).toEqual({ feature: "extract", label: "設定資料の抽出", fellBack: false });
  expect(rows.find((r) => r.feature === "typo")).toEqual({ feature: "typo", label: "誤字脱字", assigned: "Claude・m1", fellBack: false });
  expect(rows.find((r) => r.feature === "chat")!.fellBack).toBe(true);
  expect(rows.at(-1)!.label).toBe("朗読の台詞の話者と感情");
  const html = renderFeatureRows(rows);
  expect(html).toContain("鍵が無いので既定で動きます");
  expect(html).toContain("既定のまま");
  expect(describeChoice({ provider: "sakura", model: "s" })).toBe("さくらのAI Engine・s");
});
