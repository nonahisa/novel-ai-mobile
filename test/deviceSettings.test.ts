import { describe, expect, test } from "vitest";
import { DEVICE_ID_KEY, isValidDeviceId } from "novel-ai-assistant/src/core/device";
import { DeviceSettings, deviceId, type SettingsBackend } from "../src/platform/deviceSettings";

/** 端末の `Preferences` の代わり（文字列だけを持つ。端末と同じ） */
class MemoryBackend implements SettingsBackend {
  readonly raw = new Map<string, string>();
  async keys() {
    return [...this.raw.keys()];
  }
  async get(key: string) {
    return this.raw.get(key) ?? null;
  }
  async set(key: string, value: string) {
    this.raw.set(key, value);
  }
}

describe("端末の設定（本体の globalState の代わり）", () => {
  test("書いた値は、アプリを開き直しても読める（文字列以外も）", async () => {
    const backend = new MemoryBackend();
    const { settings } = await DeviceSettings.load(backend);
    await settings.update("novelai.sample", { count: 3, names: ["灯", "澪"] });

    const { settings: reopened } = await DeviceSettings.load(backend);
    expect(reopened.get("novelai.sample")).toEqual({ count: 3, names: ["灯", "澪"] });
    expect(reopened.get("novelai.missing", "既定")).toBe("既定");
  });

  test("読めない値は持たず、直しもしない（鍵を知らせる）", async () => {
    const backend = new MemoryBackend();
    backend.raw.set("novelai.broken", "{壊れた");
    const { settings, unreadable } = await DeviceSettings.load(backend);
    expect(unreadable).toEqual(["novelai.broken"]);
    expect(settings.get("novelai.broken")).toBeUndefined();
    expect(backend.raw.get("novelai.broken")).toBe("{壊れた");
  });

  test("端末へ書けなかったら、手元の値も変えない", async () => {
    const backend = new MemoryBackend();
    backend.set = async () => {
      throw new Error("書けない");
    };
    const { settings } = await DeviceSettings.load(backend);
    await expect(settings.update("novelai.sample", 1)).rejects.toThrow("書けない");
    expect(settings.get("novelai.sample")).toBeUndefined();
  });
});

describe("端末の識別（本体の resolveDeviceId を通す）", () => {
  test("初めて開いたときに作り、開き直しても同じ ID を使う", async () => {
    const backend = new MemoryBackend();
    const first = await deviceId((await DeviceSettings.load(backend)).settings);
    expect(isValidDeviceId(first)).toBe(true);
    // テストは Capacitor の土台の外（web）で走る
    expect(first).toMatch(/^web-[0-9a-f]+$/);

    const again = await deviceId((await DeviceSettings.load(backend)).settings);
    expect(again).toBe(first);
  });

  test("形の崩れた ID は使わず、作り直す", async () => {
    const backend = new MemoryBackend();
    backend.raw.set(DEVICE_ID_KEY, JSON.stringify("壊れた ID!"));
    const id = await deviceId((await DeviceSettings.load(backend)).settings);
    expect(isValidDeviceId(id)).toBe(true);
    expect(JSON.parse(backend.raw.get(DEVICE_ID_KEY)!)).toBe(id);
  });
});
