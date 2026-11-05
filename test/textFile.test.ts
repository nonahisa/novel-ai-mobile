import iconv from "iconv-lite";
import { describe, expect, test } from "vitest";
import { MemoryFileStore } from "../src/platform/memoryFileStore";
import {
  RECOVERY_DIRECTORY_NAME,
  readTextFile,
  writeTextFilePreservingFormat,
} from "../src/platform/textFile";

/**
 * モバイル版の本文の読み書き（`src/platform/textFile.ts`）。
 *
 * 本体の `test/unit/core/textFile.test.ts` の項目のうち、置き場に関わるもの
 * （VS Code で開いている文書の確かめを除く）を、端末を使わない置き場で通す。
 * 設計書 2.3「拡張機能と同じテストを通す」の最初の分。
 */

const FILE = "作品_確認用/原稿/第1話.txt";
const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);
const shiftJis = (text: string): Uint8Array => new Uint8Array(iconv.encode(text, "shift_jis"));
const bytesOf = (bytes: Uint8Array | undefined): number[] => [...(bytes ?? [])];

function storeWith(bytes: Uint8Array): MemoryFileStore {
  const store = new MemoryFileStore();
  store.putExternally(FILE, bytes);
  return store;
}

describe("本文形式を保持した保存（モバイル版）", () => {
  test("読んで書き戻すと、直した字だけが変わり、退避先を返す", async () => {
    const store = storeWith(utf8("吾輩は猫である。\n名前はまだ無い。\n"));
    const read = await readTextFile(store, FILE);
    const result = await writeTextFilePreservingFormat(
      store, FILE, read.text.replace("猫", "犬"), read, read.hash
    );
    expect(result.ok).toBe(true);
    expect(new TextDecoder().decode(store.peek(FILE))).toBe("吾輩は犬である。\n名前はまだ無い。\n");
    if (result.ok) {
      expect(result.recoveryPath).toContain(`${RECOVERY_DIRECTORY_NAME}/`);
      // 退避先には書き換える前の本文がそのまま残る
      expect(new TextDecoder().decode(store.peek(result.recoveryPath))).toBe("吾輩は猫である。\n名前はまだ無い。\n");
    }
  });

  test("CRLF の原稿は CRLF のまま書き戻す", async () => {
    const store = storeWith(utf8("一行目\r\n二行目\r\n"));
    const read = await readTextFile(store, FILE);
    expect(read.text).toBe("一行目\n二行目\n");
    await writeTextFilePreservingFormat(store, FILE, "一行目\n直した二行目\n", read, read.hash);
    expect(new TextDecoder().decode(store.peek(FILE))).toBe("一行目\r\n直した二行目\r\n");
  });

  test("Shift_JIS の原稿は Shift_JIS のまま書き戻す", async () => {
    const store = storeWith(shiftJis("吾輩は猫である。\r\n"));
    const read = await readTextFile(store, FILE);
    await writeTextFilePreservingFormat(store, FILE, "吾輩は犬である。\n", read, read.hash);
    expect(bytesOf(store.peek(FILE))).toEqual(bytesOf(shiftJis("吾輩は犬である。\r\n")));
  });

  test("Shift_JIS で表せない字が入ったら書かない（代わりの字に置き換えない）", async () => {
    const original = shiftJis("本文\r\n");
    const store = storeWith(original);
    const read = await readTextFile(store, FILE);
    const result = await writeTextFilePreservingFormat(store, FILE, "本文🐈\n", read, read.hash);
    expect(result).toMatchObject({ ok: false, reason: "encoding_error" });
    expect(bytesOf(store.peek(FILE))).toEqual(bytesOf(original));
  });

  test("読んだあとに外で書き換えられていたら書かない", async () => {
    const store = storeWith(utf8("元の本文\n"));
    const read = await readTextFile(store, FILE);
    store.putExternally(FILE, utf8("パソコンで直した本文\n"));
    const result = await writeTextFilePreservingFormat(store, FILE, "スマホで直した本文\n", read, read.hash);
    expect(result).toMatchObject({ ok: false, reason: "modified_externally" });
    expect(new TextDecoder().decode(store.peek(FILE))).toBe("パソコンで直した本文\n");
  });

  test("保存する相手が消えていたら、外で変わったとみなして作り直さない", async () => {
    const store = storeWith(utf8("本文\n"));
    const read = await readTextFile(store, FILE);
    await store.deleteFile(FILE);
    const result = await writeTextFilePreservingFormat(store, FILE, "直した本文\n", read, read.hash);
    expect(result).toMatchObject({ ok: false, reason: "modified_externally" });
    expect(store.peek(FILE)).toBeUndefined();
  });

  test("競合の印のある本文は書かない（書く側も、今の中身も）", async () => {
    const conflicted = "<<<<<<< HEAD\nこちら\n=======\nあちら\n>>>>>>> origin/main\n";
    const store = storeWith(utf8("本文\n"));
    const read = await readTextFile(store, FILE);
    expect(await writeTextFilePreservingFormat(store, FILE, conflicted, read, read.hash)).toMatchObject({
      ok: false,
      reason: "conflict_markers",
    });

    const merged = storeWith(utf8(conflicted));
    const readMerged = await readTextFile(merged, FILE);
    expect(
      await writeTextFilePreservingFormat(merged, FILE, "直した本文\n", readMerged, readMerged.hash)
    ).toMatchObject({ ok: false, reason: "conflict_markers" });
  });

  test("退避は1ファイル5世代まで残す", async () => {
    const store = storeWith(utf8("0\n"));
    for (let i = 1; i <= 7; i += 1) {
      const read = await readTextFile(store, FILE);
      const result = await writeTextFilePreservingFormat(store, FILE, `${i}\n`, read, read.hash);
      expect(result.ok).toBe(true);
    }
    const recoveries = await store.listFiles(`作品_確認用/原稿/${RECOVERY_DIRECTORY_NAME}`);
    expect(recoveries).toHaveLength(5);
    expect(new TextDecoder().decode(store.peek(FILE))).toBe("7\n");
  });

  test("別の話の退避は、片付けで消さない", async () => {
    const other = "作品_確認用/原稿/第2話.txt";
    const store = storeWith(utf8("一\n"));
    store.putExternally(other, utf8("二\n"));
    const readOther = await readTextFile(store, other);
    await writeTextFilePreservingFormat(store, other, "二の改\n", readOther, readOther.hash);
    for (let i = 0; i < 6; i += 1) {
      const read = await readTextFile(store, FILE);
      await writeTextFilePreservingFormat(store, FILE, `一の${i}\n`, read, read.hash);
    }
    const recoveries = await store.listFiles(`作品_確認用/原稿/${RECOVERY_DIRECTORY_NAME}`);
    expect(recoveries).toHaveLength(6);
  });
});
