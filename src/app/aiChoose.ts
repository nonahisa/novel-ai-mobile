import { CLOUD_PROVIDERS, checkApiKey, type CloudProviderId } from "../platform/aiKeys";
import type { SecretVault } from "../platform/secretVault";
import { chooseFrom } from "./dialog";

/**
 * **その回だけ使う AI を選ぶ**（設計書 7章「走らせる直前の見積もり（F）：『どの AI で』の行を押すと、その回だけ別の AI に替えられる」）。
 * 鍵のある AI を並べ、選んだ AI のモデルの一覧（本文は送らない）からモデルを選ぶ。設定（既定・機能ごとの割り当て）は変えない
 */
export async function chooseAiForRun(
  vault: SecretVault,
  toast: (text: string) => void,
  fetchModels: (id: CloudProviderId, key: string) => ReturnType<typeof checkApiKey> = (id, key) => checkApiKey(id, key)
): Promise<{ provider: CloudProviderId; model: string } | undefined> {
  const usable: CloudProviderId[] = [];
  for (const provider of CLOUD_PROVIDERS) if ((await vault.get(provider.secret)) !== undefined) usable.push(provider.id);
  if (usable.length === 0) {
    toast("先に APIキーを登録してください");
    return undefined;
  }
  const picked = await chooseFrom(CLOUD_PROVIDERS.filter((provider) => usable.includes(provider.id)).map((provider) => ({ id: provider.id, label: provider.displayName })));
  if (!picked) return undefined;
  const provider = CLOUD_PROVIDERS.find((candidate) => candidate.id === picked)!;
  const key = await vault.get(provider.secret);
  if (!key) return undefined;
  const check = await fetchModels(provider.id, key);
  if (check.kind !== "ok" || check.models.length === 0) {
    toast(check.kind === "ok" ? "選べるモデルがありません" : "モデルの一覧を読めませんでした");
    return undefined;
  }
  const model = await chooseFrom(check.models.map((name) => ({ id: name, label: name })));
  return model ? { provider: provider.id, model } : undefined;
}
