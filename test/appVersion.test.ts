import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

/**
 * モバイル版の版は3か所にある。ずれると、作者の端末に入った版と画面に出る版が食い違う。
 * `package.json`（画面に出す版のもと）・Android の `versionName`・iOS の `MARKETING_VERSION`。
 * 端末へ入れ直すときに古い版と見なされないよう、Android の `versionCode` と iOS の
 * `CURRENT_PROJECT_VERSION` も同じ数にそろえる（版を上げるたびに1つ増やす）。
 */

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

describe("モバイル版の版", () => {
  const pkg = (JSON.parse(read("package.json")) as { version: string }).version;
  const gradle = read("android/app/build.gradle");
  const pbx = read("ios/App/App.xcodeproj/project.pbxproj");

  test("package.json・Android・iOS の版の名前がそろっている", () => {
    expect(pkg).toMatch(/^\d+\.\d+\.\d+$/);
    expect(gradle).toContain(`versionName "${pkg}"`);
    const marketing = [...pbx.matchAll(/MARKETING_VERSION = ([^;]+);/g)].map((m) => m[1]);
    expect(marketing.length).toBeGreaterThan(0);
    for (const v of marketing) expect(v).toBe(pkg);
  });

  test("Android の versionCode と iOS の CURRENT_PROJECT_VERSION が同じ数", () => {
    const code = /versionCode (\d+)/.exec(gradle)?.[1];
    const builds = [...pbx.matchAll(/CURRENT_PROJECT_VERSION = (\d+);/g)].map((m) => m[1]);
    expect(code).toBeDefined();
    for (const b of builds) expect(b).toBe(code);
  });
});
