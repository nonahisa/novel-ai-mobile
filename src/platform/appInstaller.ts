import { registerPlugin } from "@capacitor/core";
import type { UpdateAsset } from "./appUpdate";

/**
 * **Android：新しい版を取り寄せて照らし、端末のインストーラーへ渡す**（更新の仕組み（3）。引継ぎ書 156章。
 * 共通の決まりは統合の `docs/更新の仕組み_共通.md`）。
 *
 * - 作者が知らせの［入れる］を押したときだけ動く
 * - 入れる前に、製品の設定（端末の localStorage）の控えをアプリの領域に取る。作品・原稿には触らない
 * - 「このアプリからの入れ替え」（提供元不明のアプリ）が許されていなければ、わけを言って端末の設定を開く
 * - 取り寄せと照らしは端末の側（`AppUpdatePlugin.java`）：このリポジトリの Release の下の物だけ・SHA-256 と大きさ・
 *   中の製品の名前と版の番号を照らし、合わなければ消して止める。合えば端末のインストーラーを開く（入れるかは作者が決める）
 * - 止めたら、わけを1行と次の一手を1つ出す。通信の失敗のわけは当てない
 */

export interface AppUpdatePlugin {
  canInstall(): Promise<{ allowed: boolean }>;
  openInstallSettings(): Promise<void>;
  downloadAndInstall(options: { url: string; sha256: string; bytes: number; name: string }): Promise<void>;
}

export const AppUpdateNative = registerPlugin<AppUpdatePlugin>("AppUpdate");

export interface InstallerDeps {
  current: string;
  /** 製品の設定の控え（作品・原稿は入らない） */
  settingsSnapshot(): Record<string, string>;
  /** 控えをアプリの領域（`update-backup/<名前>`）に書く */
  saveBackup(name: string, text: string): Promise<void>;
  plugin: AppUpdatePlugin;
  ask(message: string, yes: string, no: string): Promise<boolean>;
  tell(message: string): Promise<void>;
  toast(message: string): void;
}

export const INSTALL_MESSAGES = {
  notAllowed:
    "新しい版を入れるには、端末の設定で「このアプリからの入れ替え（提供元不明のアプリ）」を許す必要があります。設定を開きますか（許したら、戻って［入れる］をもう一度押してください）",
  mismatch: "届いた中身が札と合わないので、入れませんでした。時間をおいて［ほか］→［設定］→［更新］の［今すぐ確かめる］からやり直してください",
  wrongPackage: "届いた APK がこのアプリの新しい版ではないので、入れませんでした。母艦に知らせてください",
  failed: "取り寄せられませんでした。通信のあるところで、もう一度［入れる］を押してください",
} as const;

/** 製品の設定だけを控える（`novelai.` で始まる端末の設定。合言葉や鍵は Keystore にあり、ここには入らない） */
export function snapshotSettings(storage: Storage | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    for (let i = 0; i < (storage?.length ?? 0); i++) {
      const key = storage!.key(i);
      if (key && key.startsWith("novelai.")) out[key] = storage!.getItem(key) ?? "";
    }
  } catch {
    // 読めなければ空の控え
  }
  return out;
}

export async function installUpdate(asset: UpdateAsset, deps: InstallerDeps): Promise<void> {
  await deps.saveBackup(`settings-${deps.current}.json`, `${JSON.stringify(deps.settingsSnapshot(), null, 2)}\n`);
  const { allowed } = await deps.plugin.canInstall();
  if (!allowed) {
    if (await deps.ask(INSTALL_MESSAGES.notAllowed, "設定を開く", "やめる")) await deps.plugin.openInstallSettings();
    return;
  }
  deps.toast(`新しい版を取り寄せています（${Math.round(asset.bytes / 1024 / 1024)}MB）`);
  try {
    await deps.plugin.downloadAndInstall({ url: asset.url, sha256: asset.sha256, bytes: asset.bytes, name: asset.name });
  } catch (error) {
    const code = (error as { code?: unknown })?.code;
    await deps.tell(code === "MISMATCH" ? INSTALL_MESSAGES.mismatch : code === "WRONG_PACKAGE" ? INSTALL_MESSAGES.wrongPackage : INSTALL_MESSAGES.failed);
  }
}
