import "../src/platform/bufferShim";
import git from "isomorphic-git";
import { describe, expect, test } from "vitest";
import { MemoryGitFsBackend, createGitFs } from "../src/platform/gitFs";
import { createTouchedRecorder, forgetTouched, noteTouched, readTouched, splitStorePath } from "../src/platform/touchedPaths";
import { createAutoSave } from "../src/app/autoSave";
import { MemoryFileStore } from "../src/platform/memoryFileStore";
import { readTextFile } from "../src/platform/textFile";

/** アプリが書いた話の控え（`src/platform/touchedPaths.ts`。引継ぎ書 61章）。作品は作り物（`_確認用`）だけ */

async function repo() {
  const fs = createGitFs(new MemoryGitFsBackend());
  await fs.promises.mkdir("/works");
  await fs.promises.mkdir("/works/書庫_確認用");
  await git.init({ fs, dir: "/works/書庫_確認用", defaultBranch: "main" });
  await fs.promises.mkdir("/works/手元だけ_確認用");
  return fs;
}

describe("名指しの控え", () => {
  test("置き場の道をリポジトリとその中の道に分け、並べて控える。重ねても1つ。git でない作品は控えない", async () => {
    const fs = await repo();
    expect(splitStorePath("書庫_確認用/港_確認用/本文/第1話.txt")).toEqual({ repo: "書庫_確認用", path: "港_確認用/本文/第1話.txt" });
    expect(splitStorePath("直下.txt")).toBeUndefined();
    const record = createTouchedRecorder(fs, "/works");
    void record("書庫_確認用/港_確認用/本文/第1話.txt");
    void record("書庫_確認用/灯_確認用/本文/第1話.txt");
    await record("書庫_確認用/港_確認用/本文/第1話.txt");
    await record("手元だけ_確認用/本文/第1話.txt");
    expect(await readTouched(fs, "/works/書庫_確認用")).toEqual(["港_確認用/本文/第1話.txt", "灯_確認用/本文/第1話.txt"]);
    expect(await readTouched(fs, "/works/手元だけ_確認用")).toEqual([]);
  });

  test("送った作品の控えだけ消す（書庫のほかの作品は残す）。壊れた控えは空とみなす", async () => {
    const fs = await repo();
    const dir = "/works/書庫_確認用";
    await noteTouched(fs, dir, "港_確認用/本文/第1話.txt");
    await noteTouched(fs, dir, "灯_確認用/本文/第1話.txt");
    await forgetTouched(fs, dir, (path) => !path.startsWith("港_確認用/"));
    expect(await readTouched(fs, dir)).toEqual(["灯_確認用/本文/第1話.txt"]);
    await forgetTouched(fs, dir);
    expect(await readTouched(fs, dir)).toEqual([]);
    await fs.promises.writeFile(`${dir}/.git/novelai-touched.json`, "{壊れた");
    expect(await readTouched(fs, dir)).toEqual([]);
  });

  test("自動保存は、書く直前に控える（控えが先・書くのが後）。控えが投げても書く", async () => {
    const store = new MemoryFileStore();
    const path = "作品_確認用/本文/第1話.txt";
    store.putExternally(path, new TextEncoder().encode("一\n"));
    const order: string[] = [];
    const autoSave = createAutoSave({
      store,
      path,
      opened: await readTextFile(store, path),
      beforeWrite: async (p) => {
        order.push(`控え ${p} 中身=${new TextDecoder().decode(await store.readFile(p))}`);
        throw new Error("控えの置き場が無い");
      },
    });
    autoSave.edit("二\n");
    expect(await autoSave.flush()).toBe("保存済み");
    expect(order).toEqual([`控え ${path} 中身=一\n`]);
    expect(new TextDecoder().decode(await store.readFile(path))).toBe("二\n");
  });
});
