import { describe, expect, it } from "vitest";
import { installUpdate, type InstallerDeps } from "../src/platform/appInstaller";
import type { UpdateAsset } from "../src/platform/appUpdate";

const asset: UpdateAsset = {
  platform: "android",
  name: "novel-ai-mobile-0.1.141.apk",
  url: "https://github.com/nonahisa/novel-ai-mobile/releases/download/v0.1.141/novel-ai-mobile-0.1.141.apk",
  sha256: "a".repeat(64),
  bytes: 1234,
};

function fake(over: Partial<InstallerDeps> = {}, log: string[] = []) {
  const deps: InstallerDeps = {
    current: "0.1.140",
    settingsSnapshot: () => ({ "novelai.bodySize": "18" }),
    saveBackup: async (name, text) => void log.push(`backup ${name} ${text}`),
    plugin: {
      canInstall: async () => ({ allowed: true }),
      openInstallSettings: async () => void log.push("settings"),
      downloadAndInstall: async (o) => void log.push(`install ${o.url} ${o.sha256} ${o.bytes}`),
    },
    ask: async (message) => {
      log.push(`ask ${message}`);
      return true;
    },
    tell: async (message) => void log.push(`tell ${message}`),
    toast: (message) => void log.push(`toast ${message}`),
    ...over,
  };
  return { deps, log };
}

describe("Android：新しい版を取り寄せて照らし、端末のインストーラーへ渡す（引継ぎ書 156章）", () => {
  it("入れる前に設定の控えを取り、取り寄せて渡す", async () => {
    const { deps, log } = fake();
    await installUpdate(asset, deps);
    expect(log[0]).toBe('backup settings-0.1.140.json {\n  "novelai.bodySize": "18"\n}\n');
    expect(log).toContain(`install ${asset.url} ${asset.sha256} 1234`);
    expect(log.indexOf(`install ${asset.url} ${asset.sha256} 1234`)).toBeGreaterThan(0);
  });

  it("このアプリからの入れ替えが許されていなければ、わけを言って端末の設定を開く（取り寄せない）", async () => {
    const log: string[] = [];
    const { deps } = fake(
      {
        plugin: {
          canInstall: async () => ({ allowed: false }),
          openInstallSettings: async () => void log.push("settings"),
          downloadAndInstall: async () => void log.push("install"),
        },
      },
      log
    );
    await installUpdate(asset, deps);
    expect(log.some((l) => l.startsWith("ask ") && l.includes("このアプリからの入れ替え"))).toBe(true);
    expect(log).toContain("settings");
    expect(log).not.toContain("install");
  });

  it("届いた中身が合わなければ止め、わけを1行と次の一手を1つ出す", async () => {
    const { deps, log } = fake({
      plugin: {
        ...fake().deps.plugin,
        downloadAndInstall: async () => {
          throw Object.assign(new Error("mismatch"), { code: "MISMATCH" });
        },
      },
    });
    await installUpdate(asset, deps);
    const told = log.find((l) => l.startsWith("tell "));
    expect(told).toContain("届いた中身が札と合わないので、入れませんでした");
    expect(told).toContain("［今すぐ確かめる］");
  });

  it("取り寄せが落ちたら、わけを当てずに、もう一度の一手を出す", async () => {
    const { deps, log } = fake({
      plugin: {
        ...fake().deps.plugin,
        downloadAndInstall: async () => {
          throw new Error("timeout");
        },
      },
    });
    await installUpdate(asset, deps);
    expect(log.find((l) => l.startsWith("tell "))).toBe("tell 取り寄せられませんでした。通信のあるところで、もう一度［入れる］を押してください");
  });
});
