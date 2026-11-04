import { describe, expect, test } from "vitest";
import * as path from "../src/platform/paths";

/**
 * モバイル版のファイルの場所（`src/platform/paths.ts`）。
 *
 * 組み立ては本体の `pathText.ts` をそのまま使うので、ここでは
 * **モバイル版の場所の形（`novelai-device:/works/...`）で本体の部品が正しく答えるか**と、
 * 置き場の相対パスとの往復を見る。テストは Windows で走るので、`\` が混ざらないことも見る。
 */

const work = path.fromStorePath("作品_確認用");

describe("モバイル版の場所の組み立て（本体の pathText を通す）", () => {
  test("join は `/` で繋ぐ（Windows で走らせても `\\` にならない）", () => {
    expect(path.join(work, "原稿", "第1話.txt")).toBe("novelai-device:/works/作品_確認用/原稿/第1話.txt");
  });

  test("dirname・basename・extname が日本語の名前で効く", () => {
    const file = path.join(work, "原稿", "第1話.txt");
    expect(path.dirname(file)).toBe("novelai-device:/works/作品_確認用/原稿");
    expect(path.basename(file)).toBe("第1話.txt");
    expect(path.extname(file)).toBe(".txt");
  });

  test("作品の中か外かを、前方一致で取り違えない", () => {
    const other = path.fromStorePath("作品_確認用2");
    expect(path.isPathInside(work, path.join(work, "原稿", "第1話.txt"))).toBe(true);
    expect(path.isPathInside(work, path.join(other, "原稿", "第1話.txt"))).toBe(false);
    expect(path.isPathInside(work, path.join(work, "..下書き", "メモ.txt"))).toBe(true);
  });
});

describe("置き場の相対パスとの往復", () => {
  test("往復して同じものに戻る", () => {
    const store = "作品_確認用/原稿/第1話.txt";
    expect(path.toStorePath(path.fromStorePath(store))).toBe(store);
    expect(path.toStorePath(path.fromStorePath(""))).toBe("");
  });

  test("符号化された日本語（%E4…）も、同じ置き場のパスに戻る", () => {
    const encoded = `novelai-device:/works/${encodeURIComponent("作品_確認用")}/${encodeURIComponent("第1話.txt")}`;
    expect(path.toStorePath(encoded)).toBe("作品_確認用/第1話.txt");
  });

  test("置き場の外は読み書きしない（`undefined`）", () => {
    expect(path.toStorePath("C:\\novels\\第1話.txt")).toBeUndefined();
    expect(path.toStorePath("vscode-vfs://github/nonahisa/mynovel/第1話.txt")).toBeUndefined();
    expect(path.toStorePath("novelai-device:/works/../秘密.txt")).toBeUndefined();
    expect(path.toStorePath("novelai-device:/worksplus/第1話.txt")).toBeUndefined();
  });

  test("置き場の外を指す相対パスからは、場所を作らない", () => {
    expect(() => path.fromStorePath("../秘密.txt")).toThrow();
  });
});
