import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

/**
 * アプリのアイコンは本体の拡張機能のアイコン（novel-ai-assistant の media/icon.png：濃紺の地に白い万年筆と
 * キーボード）から作る（2026-11-08 作者「わかりやすいよう、アプリのロゴをいつものに」）。
 * PNG の頭（幅・高さ・色の型）だけを見る
 */
function pngHead(path: string): { width: number; height: number; colorType: number } {
  const b = readFileSync(new URL(`../${path}`, import.meta.url));
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20), colorType: b[25] };
}

describe("アプリのアイコン", () => {
  test("iOS は 1024 四方で、透明を持たない（App Store の決まり）", () => {
    expect(pngHead("ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png")).toEqual({ width: 1024, height: 1024, colorType: 2 });
  });
  test("Android は密度ごとの大きさ（前景は 108dp の分）", () => {
    const sizes: [string, number][] = [["mdpi", 48], ["hdpi", 72], ["xhdpi", 96], ["xxhdpi", 144], ["xxxhdpi", 192]];
    for (const [d, s] of sizes) {
      const res = `android/app/src/main/res/mipmap-${d}`;
      expect(pngHead(`${res}/ic_launcher.png`)).toMatchObject({ width: s, height: s });
      expect(pngHead(`${res}/ic_launcher_round.png`)).toMatchObject({ width: s, height: s });
      expect(pngHead(`${res}/ic_launcher_foreground.png`)).toMatchObject({ width: (s * 108) / 48, height: (s * 108) / 48 });
    }
  });
  test("Android の地の色は、本体のアイコンの濃紺", () => {
    const xml = readFileSync(new URL("../android/app/src/main/res/values/ic_launcher_background.xml", import.meta.url), "utf8");
    expect(xml).toContain("#222733");
  });
});
