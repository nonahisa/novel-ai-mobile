import { describe, expect, test } from "vitest";
import { ReplaceError, replaceViaTemp, tempPathFor, type ReplaceOps } from "../src/platform/atomicReplace";

/**
 * 在るファイルを、途中で止められても半分にならない形で書き換える（`src/platform/atomicReplace.ts`。引継ぎ書 62章）。
 * 置き場は偽物（Map）。名前の変更が在るファイルを置き換える形（Android）と、断る形（iOS かもしれない）の両方で見る
 */

const PATH = "灯台守_確認用/本文/第1話.txt";
const utf8 = (s: string) => new TextEncoder().encode(s);
const text = (b: Uint8Array | undefined) => (b ? new TextDecoder().decode(b) : undefined);

function fakeStore(options: { renameReplaces?: boolean; failWrite?: "temp"; failRename?: number; mangle?: boolean } = {}) {
  const files = new Map<string, Uint8Array>([[PATH, utf8("前の原稿\n")]]);
  let renames = 0;
  const ops: ReplaceOps = {
    write: async (path, bytes) => {
      if (options.failWrite === "temp" && path.includes(".tmp-")) {
        files.set(path, bytes.slice(0, 2)); // 途中まで書いて止まった
        throw new Error("止められた");
      }
      files.set(path, bytes);
    },
    read: async (path) => {
      const bytes = files.get(path);
      if (!bytes) throw new Error("無い");
      return options.mangle ? utf8("化けた") : bytes;
    },
    rename: async (from, to) => {
      renames += 1;
      if (options.failRename && renames <= options.failRename) throw new Error("名前を変えられない");
      if (files.has(to) && options.renameReplaces === false) throw new Error("在る");
      const bytes = files.get(from);
      if (!bytes) throw new Error("無い");
      files.delete(from);
      files.set(to, bytes);
    },
    remove: async (path) => {
      files.delete(path);
    },
    exists: async (path) => files.has(path),
    mkdir: async () => undefined,
  };
  const temps = () => [...files.keys()].filter((path) => path.includes(".tmp-"));
  return { files, ops, temps };
}

describe("途中で止められても半分にならない書き換え", () => {
  test("一時ファイルは同じフォルダーの退避のフォルダー（送らない・数えない）", () => {
    expect(tempPathFor(PATH, ".tmp-x")).toBe("灯台守_確認用/本文/.novelai-recovery/.tmp-x");
  });

  test("名前の変更が置き換える形（Android）でも、断る形でも、書き換わって一時ファイルは残らない", async () => {
    for (const renameReplaces of [true, false]) {
      const { files, ops, temps } = fakeStore({ renameReplaces });
      await replaceViaTemp(ops, PATH, utf8("新しい原稿\n"));
      expect(text(files.get(PATH))).toBe("新しい原稿\n");
      expect(temps()).toEqual([]);
    }
  });

  test("一時ファイルを書いている途中で止められたら、元の原稿はそのまま（半分にならない）", async () => {
    const { files, ops, temps } = fakeStore({ failWrite: "temp" });
    await expect(replaceViaTemp(ops, PATH, utf8("新しい原稿\n"))).rejects.toThrow("止められた");
    expect(text(files.get(PATH))).toBe("前の原稿\n");
    expect(temps()).toEqual([]);
  });

  test("置けなかったら、書いた中身は一時ファイルに丸ごと残り、その場所を知らせる", async () => {
    const { files, ops, temps } = fakeStore({ failRename: 2 });
    const error = await replaceViaTemp(ops, PATH, utf8("新しい原稿\n")).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ReplaceError);
    const leftover = (error as ReplaceError).leftover!;
    expect(temps()).toEqual([leftover]);
    expect(text(files.get(leftover))).toBe("新しい原稿\n");
  });

  test("置いたあとに読み直して、書いたものと違えば失敗にする", async () => {
    const { ops } = fakeStore({ mangle: true });
    await expect(replaceViaTemp(ops, PATH, utf8("新しい原稿\n"))).rejects.toBeInstanceOf(ReplaceError);
  });
});
