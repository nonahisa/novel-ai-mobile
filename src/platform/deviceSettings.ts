import { Capacitor } from "@capacitor/core";
import { Preferences } from "@capacitor/preferences";
import { resolveDeviceId } from "novel-ai-assistant/src/core/device";

/**
 * 端末の設定と端末の識別（設計書 2.3。本体の `globalState` と `core/device.ts` の差し替え）。
 *
 * 本体は端末ごとの設定を VS Code の `globalState` に置く。`globalState` は**読むのが同期**
 * （`get` がすぐ値を返す）で、本体の部品（`device.ts`・`verifiedMemento.ts` など）はその形を
 * 当てにしている。Capacitor の `Preferences` は読むのも非同期なので、**起動のときに全部を
 * 読んで手元に持ち、読むのは手元から・書くのは手元と `Preferences` の両方へ**とする。
 *
 * - 作品フォルダーには置かない（設計書 2.3「端末の設定」）。同期もしない
 * - 値は JSON にして置く（`globalState` は文字列以外も持てるため、形をそろえる）
 *
 * 端末の識別は本体の `resolveDeviceId` をそのまま使う（写さない）。端末の名前の代わりに
 * 土台の名前（`android`・`ios`・`web`）を渡すので、ID は `android-1a2b` のような形になる。
 * **端末 ID は同期しない**（共通設計書 3.4・3.6）——ここ（`Preferences`）にだけ置く。
 */

/** 置き場の下の層。端末では `Preferences`、テストではメモリ */
export interface SettingsBackend {
  keys(): Promise<string[]>;
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
}

export const capacitorPreferencesBackend: SettingsBackend = {
  keys: async () => (await Preferences.keys()).keys,
  get: async (key) => (await Preferences.get({ key })).value,
  set: async (key, value) => Preferences.set({ key, value }),
};

/** 本体の `globalState` と同じ形（読むのは同期、書くのは非同期） */
export class DeviceSettings {
  private constructor(
    private readonly backend: SettingsBackend,
    private readonly values: Map<string, unknown>
  ) {}

  /**
   * 起動のときに一度だけ呼ぶ。**読めない値（壊れた JSON）は持たない**——
   * 直して書き戻すと、作者が何を設定していたかが分からなくなる（本体の決まり「壊れたものは直さず止める」）。
   * 読めなかった鍵は `unreadable` に入るので、呼ぶ側が知らせる。
   */
  static async load(backend: SettingsBackend = capacitorPreferencesBackend): Promise<{
    settings: DeviceSettings;
    unreadable: string[];
  }> {
    const values = new Map<string, unknown>();
    const unreadable: string[] = [];
    for (const key of await backend.keys()) {
      const raw = await backend.get(key);
      if (raw === null) continue;
      try {
        values.set(key, JSON.parse(raw));
      } catch {
        unreadable.push(key);
      }
    }
    return { settings: new DeviceSettings(backend, values), unreadable };
  }

  get<T>(key: string, defaultValue?: T): T | undefined {
    return this.values.has(key) ? (this.values.get(key) as T) : defaultValue;
  }

  keys(): readonly string[] {
    return [...this.values.keys()];
  }

  /** 端末へ書けてから手元を変える（書けなかったのに書けたように見せない） */
  async update(key: string, value: unknown): Promise<void> {
    await this.backend.set(key, JSON.stringify(value));
    this.values.set(key, value);
  }
}

/** この端末の ID（無ければ作って置く。本体の `resolveDeviceId` を通す） */
export async function deviceId(settings: DeviceSettings): Promise<string> {
  return resolveDeviceId(
    { get: (key) => settings.get<string>(key), update: (key, value) => settings.update(key, value) },
    Capacitor.getPlatform()
  );
}
