import iconv from "iconv-lite";
import { describe, expect, test } from "vitest";
import { decodeBytes } from "novel-ai-assistant/src/core/textDecode";
import { MemoryFileStore } from "../src/platform/memoryFileStore";
import { encodeForNewFile, writeTextFilePreservingFormat } from "../src/platform/textFile";

/**
 * 本体の `test/unit/core/textFile.test.ts` の残りの項目（`textFile.test.ts` の続き）。
 *
 * 本体と同じ入力・同じ答えにしてある。**VS Code の「保存していない文書」の項目と、
 * `rename` を呼ばないことの項目は移していない**——モバイル版には VS Code の文書が無く、
 * 置き場に `rename` が無い（退避は初めから「コピー＋削除」）。
 */

const FILE = "作品_確認用/原稿/001.txt";
const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);
const shiftJis = (text: string): Uint8Array => new Uint8Array(iconv.encode(text, "shift_jis"));
const bom = (bytes: Uint8Array): Uint8Array => new Uint8Array([0xef, 0xbb, 0xbf, ...bytes]);

function storeWith(bytes: Uint8Array): MemoryFileStore {
  const store = new MemoryFileStore();
  store.putExternally(FILE, bytes);
  return store;
}

async function save(
  store: MemoryFileStore,
  text: string,
  original: ReturnType<typeof decodeBytes>,
  options: { eol?: "\n" | "\r\n"; rewriteEol?: boolean } = {}
) {
  return writeTextFilePreservingFormat(
    store,
    FILE,
    text,
    { ...original, ...(options.eol ? { eol: options.eol } : {}) },
    original.hash,
    { rewriteEol: options.rewriteEol }
  );
}

describe("本文形式を保持した保存（本体の項目の続き）", () => {
  test("元に末尾改行がある場合は修正文にも末尾改行を復元する", async () => {
    const original = decodeBytes(utf8("灯\n澪\n"));
    const store = storeWith(utf8("灯\n澪\n"));
    expect((await save(store, "灯\n翠", original)).ok).toBe(true);
    expect(new TextDecoder().decode(store.peek(FILE))).toBe("灯\n翠\n");
  });

  test("混在したCRLF・LF・CRを無変更箇所では元のバイト列のまま残す", async () => {
    const bytes = utf8("甲\r\n乙\n丙\r丁");
    const store = storeWith(bytes);
    await save(store, "甲\n乙改\n丙\n丁", decodeBytes(bytes));
    expect(store.peek(FILE)).toEqual(utf8("甲\r\n乙改\n丙\r丁"));
  });

  describe("改行コードだけを揃える", () => {
    test("既定では、渡したeolでは改行が変わらない", async () => {
      const bytes = utf8("灯\r\n澪\r\n");
      const original = decodeBytes(bytes);
      const store = storeWith(bytes);
      await save(store, original.text, original, { eol: "\n" });
      expect(store.peek(FILE)).toEqual(bytes);
    });

    test("rewriteEolを立てると、本文はそのままで改行だけが変わる", async () => {
      const bytes = utf8("灯\r\n澪\r\n");
      const original = decodeBytes(bytes);
      const store = storeWith(bytes);
      await save(store, original.text, original, { eol: "\n", rewriteEol: true });
      expect(store.peek(FILE)).toEqual(utf8("灯\n澪\n"));
      expect(decodeBytes(store.peek(FILE)!).text).toBe(original.text);
    });

    test("Shift_JISのまま、改行だけを揃える", async () => {
      const bytes = shiftJis("灯\r\n澪\r\n");
      const original = decodeBytes(bytes);
      const store = storeWith(bytes);
      await save(store, original.text, original, { eol: "\n", rewriteEol: true });
      expect(store.peek(FILE)).toEqual(shiftJis("灯\n澪\n"));
    });

    test("非正規のCP932バイトも、そのまま残る", async () => {
      const special = [0xee, 0xe0];
      const bytes = new Uint8Array([...special, 0x0d, 0x0a, ...shiftJis("末尾"), 0x0d, 0x0a]);
      const original = decodeBytes(bytes);
      const store = storeWith(bytes);
      await save(store, original.text, original, { eol: "\n", rewriteEol: true });
      expect(store.peek(FILE)).toEqual(new Uint8Array([...special, 0x0a, ...shiftJis("末尾"), 0x0a]));
    });

    test("BOMは残り、末尾改行の無さも保たれる", async () => {
      const bytes = bom(utf8("灯\r\n澪"));
      const original = decodeBytes(bytes);
      const store = storeWith(bytes);
      await save(store, original.text, original, { eol: "\n", rewriteEol: true });
      expect(store.peek(FILE)).toEqual(bom(utf8("灯\n澪")));
    });

    test("混ざった改行も、まとめて揃う", async () => {
      const bytes = utf8("甲\r\n乙\n丙\r丁");
      const original = decodeBytes(bytes);
      const store = storeWith(bytes);
      await save(store, original.text, original, { eol: "\r\n", rewriteEol: true });
      expect(store.peek(FILE)).toEqual(utf8("甲\r\n乙\r\n丙\r\n丁"));
    });
  });

  test.each([
    ["NEC選定IBM拡張文字", [0xee, 0xe0]],
    ["NEC特殊文字", [0x87, 0x90]],
    ["IBM拡張文字", [0xed, 0x40]],
  ])("無変更のCP932 %s (%s) を元のバイト列のまま保存する", async (_label, raw) => {
    const bytes = new Uint8Array([...raw, ...shiftJis("\r\n末尾")]);
    const original = decodeBytes(bytes);
    const store = storeWith(bytes);
    expect((await save(store, original.text, original)).ok).toBe(true);
    expect(store.peek(FILE)).toEqual(bytes);
  });

  test("CP932の小さな編集は変更文字のバイトだけを差し替える", async () => {
    const prefix = [0xee, 0xe0, 0x0d, 0x0a];
    const suffix = [0x0a, 0x87, 0x90, 0x0d, 0xed, 0x40];
    const bytes = new Uint8Array([...prefix, ...shiftJis("旧"), ...suffix]);
    const original = decodeBytes(bytes);
    const store = storeWith(bytes);
    await save(store, original.text.replace("旧", "新"), original);
    expect(store.peek(FILE)).toEqual(new Uint8Array([...prefix, ...shiftJis("新"), ...suffix]));
  });

  test("大きな本文の一点編集でも周囲の非正規CP932バイトを保持する", async () => {
    const repeated = Array.from({ length: 20_000 }, () => [0xee, 0xe0, 0x0a]).flat();
    const bytes = new Uint8Array([...repeated, ...shiftJis("旧"), ...repeated]);
    const original = decodeBytes(bytes);
    const store = storeWith(bytes);
    await save(store, original.text.replace("旧", "新"), original);
    const saved = store.peek(FILE)!;
    expect(saved.slice(0, repeated.length)).toEqual(bytes.slice(0, repeated.length));
    expect(saved.slice(-repeated.length)).toEqual(bytes.slice(-repeated.length));
  });

  test("ハッシュなしの保存要求では元ファイルへ書かない", async () => {
    const bytes = shiftJis("灯\n澪\n");
    const original = decodeBytes(bytes);
    const store = storeWith(bytes);
    const result = await writeTextFilePreservingFormat(store, FILE, original.text, original, undefined as never);
    expect(result).toEqual({ ok: false, reason: "modified_externally" });
    expect(store.peek(FILE)).toEqual(bytes);
  });
});

describe("置き場がうまく動かないとき（本体の項目の続き）", () => {
  test("退避後に何者かが同じ場所へ書き込んでいたら、外部の内容を上書きも削除もしない", async () => {
    const originalBytes = utf8("灯\n澪\n");
    const changedByAuthor = utf8("灯\n碧\n");
    const original = decodeBytes(originalBytes);
    // 元の原稿を消した直後に、ほかの道が同じ場所へ書く
    const store = new (class extends MemoryFileStore {
      override async deleteFile(path: string): Promise<void> {
        await super.deleteFile(path);
        if (path === FILE) this.putExternally(FILE, changedByAuthor);
      }
    })();
    store.putExternally(FILE, originalBytes);

    const result = await save(store, "灯\n翠\n", original);
    expect(result).toMatchObject({
      ok: false,
      reason: "path_conflict",
      recoveryPaths: expect.arrayContaining([expect.stringContaining(".bak")]),
    });
    expect(store.peek(FILE)).toEqual(changedByAuthor);
    const recoveryPath = result.ok ? undefined : result.recoveryPaths?.[0];
    expect(store.peek(recoveryPath!)).toEqual(originalBytes);
  });

  test("回復先ディレクトリを準備できなければ、原稿へは触れずに理由を返す", async () => {
    const originalBytes = utf8("灯\n澪\n");
    const store = new (class extends MemoryFileStore {
      override async createDirectory(): Promise<void> {
        throw new Error("denied");
      }
    })();
    store.putExternally(FILE, originalBytes);

    const result = await save(store, "灯\n翠\n", decodeBytes(originalBytes));
    expect(result).toMatchObject({ ok: false, reason: "path_conflict", detail: expect.stringContaining("回復先") });
    expect(store.peek(FILE)).toEqual(originalBytes);
  });

  test("新しい内容の配置で想定外のエラーが起きても、原稿は回復先で失われない", async () => {
    const originalBytes = utf8("灯\n澪\n");
    const store = new (class extends MemoryFileStore {
      override async writeFile(path: string, bytes: Uint8Array, options: { mode: "create" }): Promise<void> {
        if (path.includes(".novelai-recovery")) return super.writeFile(path, bytes, options);
        throw new Error("write failed");
      }
    })();
    store.putExternally(FILE, originalBytes);
    const original = decodeBytes(originalBytes);

    const result = await save(store, original.text, original);
    expect(result).toMatchObject({
      ok: false,
      reason: "path_conflict",
      detail: expect.stringContaining("write failed"),
      recoveryPaths: expect.arrayContaining([expect.stringContaining(".bak")]),
    });
    const recoveryPath = result.ok ? undefined : result.recoveryPaths?.[0];
    expect(store.peek(recoveryPath!)).toEqual(originalBytes);
  });
});

describe("別ファイルへ書き出すときの符号化", () => {
  const original = (
    overrides: Partial<{ encoding: "utf8" | "utf8-bom" | "shift_jis"; eol: "\n" | "\r\n"; hasTrailingNewline: boolean }> = {}
  ) => ({ encoding: "utf8" as const, eol: "\n" as const, hasTrailingNewline: true, ...overrides });

  test("元がShift_JISならShift_JISで書く", () => {
    const bytes = encodeForNewFile("灯は歩いた。\n", original({ encoding: "shift_jis" }));
    expect(bytes).toBeDefined();
    expect(iconv.decode(Buffer.from(bytes!), "shift_jis")).toBe("灯は歩いた。\n");
    expect(bytes).not.toEqual(utf8("灯は歩いた。\n"));
  });

  test("元がCRLFならCRLFで書く", () => {
    expect(new TextDecoder().decode(encodeForNewFile("一行目\n二行目\n", original({ eol: "\r\n" })))).toBe(
      "一行目\r\n二行目\r\n"
    );
  });

  test("元にBOMがあればBOMを付ける", () => {
    const bytes = encodeForNewFile("灯\n", original({ encoding: "utf8-bom" }))!;
    expect(Array.from(bytes.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
    expect(new TextDecoder().decode(bytes.slice(3))).toBe("灯\n");
  });

  test("元に末尾改行が無ければ付けない", () => {
    expect(new TextDecoder().decode(encodeForNewFile("灯は歩いた。\n\n", original({ hasTrailingNewline: false })))).toBe(
      "灯は歩いた。"
    );
  });

  test("元に末尾改行があれば補う", () => {
    expect(new TextDecoder().decode(encodeForNewFile("灯は歩いた。", original()))).toBe("灯は歩いた。\n");
  });

  test("入力の改行がCRLFでも、元の改行コードに揃える", () => {
    expect(new TextDecoder().decode(encodeForNewFile("一行目\r\n二行目\r\n", original({ eol: "\n" })))).toBe(
      "一行目\n二行目\n"
    );
  });

  test("Shift_JISで表せない文字があれば書き出さない", () => {
    expect(encodeForNewFile("𠮟る\n", original({ encoding: "shift_jis" }))).toBeUndefined();
  });
});

describe("改行の混在の検出", () => {
  test("CRLFだけなら混在ではない", () => {
    expect(decodeBytes(utf8("灯\r\n澪\r\n")).hasMixedEol).toBe(false);
  });
  test("LFだけなら混在ではない", () => {
    expect(decodeBytes(utf8("灯\n澪\n")).hasMixedEol).toBe(false);
  });
  test("CRLFと裸のLFが両方あれば混在", () => {
    const content = decodeBytes(utf8("灯\r\n澪\n"));
    expect(content.hasMixedEol).toBe(true);
    expect(content.eol).toBe("\r\n");
  });
});
