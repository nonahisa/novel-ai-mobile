/**
 * 端末の鍵の置き場（合言葉・鍵をしまう所。引継ぎ書 58章）。
 *
 * 部品は `@aparajita/capacitor-secure-storage`（MIT）。Android は Keystore の鍵（AES-256-GCM）で
 * 暗号にして SharedPreferences へ、iOS は Keychain へ。iOS は iCloud へ同期しない・この端末だけ
 * （`whenUnlockedThisDeviceOnly`）を、既定に頼らずはっきり渡す。
 *
 * - 名前で get / set / remove するだけ（AI の鍵も、あとでここへしまう）
 * - **読めないときは「無い」にする。** Android の自動の控え（Auto Backup）で別の端末へ戻ると、
 *   暗号の中身だけ来て Keystore の鍵が来ないので解けない。そのときはサインインし直すだけで済む
 *   （壊れた中身は消す）
 * - 中身を記録（console）に出さない
 */

export interface SecretVault {
  get(name: string): Promise<string | undefined>;
  set(name: string, value: string): Promise<void>;
  remove(name: string): Promise<void>;
}

/** GitHub の合言葉（トークン）の名前 */
export const GITHUB_TOKEN_SECRET = "github.token";

const PREFIX = "novelai_";

/** 手元だけの置き場（テスト・ブラウザでの試し） */
export class MemorySecretVault implements SecretVault {
  readonly values = new Map<string, string>();
  async get(name: string): Promise<string | undefined> {
    return this.values.get(name);
  }
  async set(name: string, value: string): Promise<void> {
    this.values.set(name, value);
  }
  async remove(name: string): Promise<void> {
    this.values.delete(name);
  }
}

/** 端末の鍵の置き場。部品は使う時に読む（ブラウザのテストの束に入れない） */
export class DeviceSecretVault implements SecretVault {
  private ready?: Promise<typeof import("@aparajita/capacitor-secure-storage")>;

  private load() {
    this.ready ??= import("@aparajita/capacitor-secure-storage").then(async (module) => {
      await module.SecureStorage.setKeyPrefix(PREFIX);
      await module.SecureStorage.setSynchronize(false);
      await module.SecureStorage.setDefaultKeychainAccess(module.KeychainAccess.whenUnlockedThisDeviceOnly);
      return module;
    });
    return this.ready;
  }

  async get(name: string): Promise<string | undefined> {
    const { SecureStorage } = await this.load();
    try {
      const value = await SecureStorage.get(name, false, false);
      return typeof value === "string" && value !== "" ? value : undefined;
    } catch {
      // 解けない（別の端末から戻った控えなど）。無いことにして、壊れた中身は消す
      await SecureStorage.remove(name, false).catch(() => undefined);
      return undefined;
    }
  }

  async set(name: string, value: string): Promise<void> {
    const { SecureStorage, KeychainAccess } = await this.load();
    await SecureStorage.set(name, value, false, false, KeychainAccess.whenUnlockedThisDeviceOnly);
  }

  async remove(name: string): Promise<void> {
    const { SecureStorage } = await this.load();
    await SecureStorage.remove(name, false);
  }
}
