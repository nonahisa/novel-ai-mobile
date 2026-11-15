import iconv from "iconv-lite";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createAutoSave, type AutoSaveStatus, type VisibilitySource } from "../src/app/autoSave";
import { MemoryFileStore } from "../src/platform/memoryFileStore";
import { RECOVERY_DIRECTORY_NAME, readTextFile } from "../src/platform/textFile";

/**
 * 自動保存の係（`src/app/autoSave.ts`。設計書 5.4）。
 * 時計は Vitest の偽の時計で進める。置き場は端末を使わない `MemoryFileStore`。
 */

const FILE = "作品_確認用/原稿/第1話.txt";
const RECOVERY_DIR = `作品_確認用/原稿/${RECOVERY_DIRECTORY_NAME}`;
const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);
const textOf = (bytes: Uint8Array | undefined): string => new TextDecoder().decode(bytes);

async function open(initial: Uint8Array = utf8("吾輩は猫である。\n")) {
  const store = new MemoryFileStore();
  store.putExternally(FILE, initial);
  const opened = await readTextFile(store, FILE);
  const autoSave = createAutoSave({ store, path: FILE, opened });
  return { store, opened, autoSave };
}

async function recoveryCount(store: MemoryFileStore): Promise<number> {
  try {
    return (await store.listFiles(RECOVERY_DIR)).length;
  } catch {
    return 0;
  }
}

/** `document` の代わり（裏に回る・戻る を起こせる） */
class FakeVisibility implements VisibilitySource {
  visibilityState = "visible";
  private readonly listeners = new Set<() => void>();
  addEventListener(_type: "visibilitychange", listener: () => void): void {
    this.listeners.add(listener);
  }
  removeEventListener(_type: "visibilitychange", listener: () => void): void {
    this.listeners.delete(listener);
  }
  change(state: "visible" | "hidden"): void {
    this.visibilityState = state;
    for (const listener of [...this.listeners]) listener();
  }
  get size(): number {
    return this.listeners.size;
  }
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("自動保存：いつ保存するか", () => {
  test("打つのを止めて2秒で保存する（1999ms ではまだ書かない）", async () => {
    const { store, autoSave } = await open();
    autoSave.edit("吾輩は犬である。\n");
    expect(autoSave.status()).toBe("保存待ち");
    await vi.advanceTimersByTimeAsync(1999);
    expect(textOf(store.peek(FILE))).toBe("吾輩は猫である。\n");
    await vi.advanceTimersByTimeAsync(1);
    expect(textOf(store.peek(FILE))).toBe("吾輩は犬である。\n");
    expect(autoSave.status()).toBe("保存済み");
  });

  test("打つたびに2秒を数え直す", async () => {
    const { store, autoSave } = await open();
    autoSave.edit("吾輩は犬");
    await vi.advanceTimersByTimeAsync(1500);
    autoSave.edit("吾輩は犬である");
    await vi.advanceTimersByTimeAsync(1500);
    expect(textOf(store.peek(FILE))).toBe("吾輩は猫である。\n");
    await vi.advanceTimersByTimeAsync(500);
    expect(textOf(store.peek(FILE))).toBe("吾輩は犬である\n");
  });

  test("flush() はすぐ保存し、時計を止める（話を移るとき）", async () => {
    const { store, autoSave } = await open();
    autoSave.edit("吾輩は犬である。\n");
    expect(await autoSave.flush()).toBe("保存済み");
    expect(textOf(store.peek(FILE))).toBe("吾輩は犬である。\n");
    expect(vi.getTimerCount()).toBe(0);
  });

  test("変えていなければ flush() でも書かない", async () => {
    const { store, autoSave } = await open();
    expect(await autoSave.flush()).toBe("保存済み");
    expect(await recoveryCount(store)).toBe(0);
    // 打って元へ戻したら、書かずに保存済み
    autoSave.edit("吾輩は犬である。\n");
    autoSave.edit("吾輩は猫である。\n");
    expect(autoSave.status()).toBe("保存済み");
    expect(vi.getTimerCount()).toBe(0);
  });

  test("アプリが裏に回ったら保存する。表に戻っただけでは書かない", async () => {
    const { store, autoSave } = await open();
    const visibility = new FakeVisibility();
    autoSave.watchVisibility(visibility);
    autoSave.edit("吾輩は犬である。\n");
    visibility.change("visible");
    await vi.advanceTimersByTimeAsync(0);
    expect(textOf(store.peek(FILE))).toBe("吾輩は猫である。\n");
    visibility.change("hidden");
    await vi.advanceTimersByTimeAsync(0);
    expect(textOf(store.peek(FILE))).toBe("吾輩は犬である。\n");
    expect(autoSave.status()).toBe("保存済み");
  });

  test("dispose() で時計と聞き手を外す", async () => {
    const { store, autoSave } = await open();
    const visibility = new FakeVisibility();
    autoSave.watchVisibility(visibility);
    autoSave.edit("吾輩は犬である。\n");
    autoSave.dispose();
    expect(visibility.size).toBe(0);
    await vi.advanceTimersByTimeAsync(5000);
    expect(textOf(store.peek(FILE))).toBe("吾輩は猫である。\n");
  });

  test("時計は差し替えられる", async () => {
    const store = new MemoryFileStore();
    store.putExternally(FILE, utf8("本文\n"));
    const opened = await readTextFile(store, FILE);
    const pending: Array<{ callback: () => void; ms: number }> = [];
    const autoSave = createAutoSave({
      store,
      path: FILE,
      opened,
      delayMs: 500,
      timer: {
        setTimeout: (callback, ms) => pending.push({ callback, ms }),
        clearTimeout: () => undefined,
      },
    });
    autoSave.edit("直した本文\n");
    expect(pending).toHaveLength(1);
    expect(pending[0]!.ms).toBe(500);
    pending[0]!.callback();
    await vi.advanceTimersByTimeAsync(0);
    expect(textOf(store.peek(FILE))).toBe("直した本文\n");
  });
});

describe("自動保存：退避とハッシュ", () => {
  test("退避は話を開いて最初の保存のときだけ。続けて保存しても1つ", async () => {
    const { store, autoSave } = await open(utf8("0\n"));
    for (let i = 1; i <= 7; i += 1) {
      autoSave.edit(`${i}\n`);
      await vi.advanceTimersByTimeAsync(2000);
      expect(autoSave.status()).toBe("保存済み");
    }
    expect(textOf(store.peek(FILE))).toBe("7\n");
    const recoveries = await store.listFiles(RECOVERY_DIR);
    expect(recoveries).toHaveLength(1);
    // 退避には開く前の本文が残る
    expect(textOf(store.peek(`${RECOVERY_DIR}/${recoveries[0]}`))).toBe("0\n");
  });

  test("保存のあいだに打った字も、外で変わったと取り違えずに続けて保存する", async () => {
    const { store, autoSave } = await open();
    autoSave.edit("一つめ\n");
    const first = autoSave.flush();
    autoSave.edit("二つめ\n");
    const second = autoSave.flush();
    expect(await first).not.toBe("外で変わりました");
    expect(await second).toBe("保存済み");
    expect(textOf(store.peek(FILE))).toBe("二つめ\n");
    expect(autoSave.lastFailure()).toBeUndefined();
  });

  test("保存のあいだに前の字へ戻しても、保存が済んだあと2秒で書き戻す", async () => {
    // 書く手を止めておける置き場（保存の途中に打つ）
    let release: () => void = () => undefined;
    let holding = false;
    const store = new (class extends MemoryFileStore {
      override async writeFile(path: string, bytes: Uint8Array, options: { mode: "create" | "overwrite" }) {
        if (holding && !path.includes(RECOVERY_DIRECTORY_NAME)) {
          await new Promise<void>((resolve) => (release = resolve));
        }
        return super.writeFile(path, bytes, options);
      }
    })();
    store.putExternally(FILE, utf8("甲\n"));
    const autoSave = createAutoSave({ store, path: FILE, opened: await readTextFile(store, FILE) });
    holding = true;
    autoSave.edit("乙\n");
    const saving = autoSave.flush();
    await vi.advanceTimersByTimeAsync(0);
    autoSave.edit("甲\n");
    release();
    holding = false;
    expect(await saving).toBe("保存待ち");
    expect(textOf(store.peek(FILE))).toBe("乙\n");
    await vi.advanceTimersByTimeAsync(2000);
    expect(textOf(store.peek(FILE))).toBe("甲\n");
    expect(autoSave.status()).toBe("保存済み");
  });

  test("時計と flush() と裏に回るのが重なっても、1つずつ保存する", async () => {
    const { store, autoSave } = await open();
    const visibility = new FakeVisibility();
    autoSave.watchVisibility(visibility);
    autoSave.edit("直した本文\n");
    await vi.advanceTimersByTimeAsync(1999);
    const flushed = autoSave.flush();
    visibility.change("hidden");
    await vi.advanceTimersByTimeAsync(2000);
    expect(await flushed).toBe("保存済み");
    expect(textOf(store.peek(FILE))).toBe("直した本文\n");
    expect(await recoveryCount(store)).toBe(1);
  });

  test("Shift_JIS・CRLF の原稿は、何度保存してもそのまま", async () => {
    const sjis = (text: string): Uint8Array => new Uint8Array(iconv.encode(text, "shift_jis"));
    const { store, autoSave } = await open(sjis("吾輩は猫である。\r\n"));
    autoSave.edit("吾輩は犬である。\n");
    await autoSave.flush();
    autoSave.edit("吾輩は犬である。\n名前はまだ無い。\n");
    await autoSave.flush();
    expect([...store.peek(FILE)!]).toEqual([...sjis("吾輩は犬である。\r\n名前はまだ無い。\r\n")]);
  });
});

describe("自動保存：外で変わったとき", () => {
  test("書かずに止め、書きかけを残して「外で変わりました」にする。以後は書かない", async () => {
    const { store, autoSave } = await open();
    autoSave.edit("スマホで直した本文\n");
    store.putExternally(FILE, utf8("パソコンで直した本文\n"));
    await vi.advanceTimersByTimeAsync(2000);
    expect(autoSave.status()).toBe("外で変わりました");
    expect(autoSave.lastFailure()?.reason).toBe("modified_externally");
    expect(autoSave.draft()).toBe("スマホで直した本文\n");
    expect(textOf(store.peek(FILE))).toBe("パソコンで直した本文\n");

    // 打っても、flush() しても、裏に回っても書かない
    const visibility = new FakeVisibility();
    autoSave.watchVisibility(visibility);
    autoSave.edit("さらに直した本文\n");
    expect(vi.getTimerCount()).toBe(0);
    expect(await autoSave.flush()).toBe("外で変わりました");
    visibility.change("hidden");
    await vi.advanceTimersByTimeAsync(5000);
    expect(textOf(store.peek(FILE))).toBe("パソコンで直した本文\n");
    expect(autoSave.draft()).toBe("さらに直した本文\n");
  });

  test("2回目からの保存（退避なし）でも、外で変わったら止める", async () => {
    const { store, autoSave } = await open();
    autoSave.edit("一\n");
    expect(await autoSave.flush()).toBe("保存済み");
    store.putExternally(FILE, utf8("同期で入れ替わった本文\n"));
    autoSave.edit("二\n");
    expect(await autoSave.flush()).toBe("外で変わりました");
    expect(textOf(store.peek(FILE))).toBe("同期で入れ替わった本文\n");
    expect(await recoveryCount(store)).toBe(1);
  });

  test("話が消えていても、作り直さずに止める", async () => {
    const { store, autoSave } = await open();
    await store.deleteFile(FILE);
    autoSave.edit("直した本文\n");
    expect(await autoSave.flush()).toBe("外で変わりました");
    expect(store.peek(FILE)).toBeUndefined();
  });
});

describe("自動保存：状態の知らせ", () => {
  test("状態が変わったときだけ知らせる", async () => {
    const { store, autoSave } = await open();
    const seen: AutoSaveStatus[] = [];
    const off = autoSave.onStatusChange((status) => seen.push(status));
    autoSave.edit("一");
    autoSave.edit("一二");
    await vi.advanceTimersByTimeAsync(2000);
    autoSave.edit("一二三");
    store.putExternally(FILE, utf8("外\n"));
    await autoSave.flush();
    expect(seen).toEqual(["保存待ち", "保存済み", "保存待ち", "外で変わりました"]);
    off();
    autoSave.edit("四");
    expect(seen).toHaveLength(4);
  });

  test("聞き手が投げても、保存は止まらない", async () => {
    const { store, autoSave } = await open();
    autoSave.onStatusChange(() => {
      throw new Error("聞き手の失敗");
    });
    autoSave.edit("一\n");
    expect(await autoSave.flush()).toBe("保存済み");
    autoSave.edit("二\n");
    await vi.advanceTimersByTimeAsync(2000);
    expect(textOf(store.peek(FILE))).toBe("二\n");
  });

  test("外で変わった以外の失敗（Shift_JIS で書けない字）は「保存待ち」のまま理由を見せ、直せば保存する", async () => {
    const sjis = (text: string): Uint8Array => new Uint8Array(iconv.encode(text, "shift_jis"));
    const { store, autoSave } = await open(sjis("本文\r\n"));
    autoSave.edit("本文🐈\n");
    expect(await autoSave.flush()).toBe("保存待ち");
    expect(autoSave.lastFailure()?.reason).toBe("encoding_error");
    expect([...store.peek(FILE)!]).toEqual([...sjis("本文\r\n")]);
    // 続けて試し続けない
    expect(vi.getTimerCount()).toBe(0);
    autoSave.edit("本文の猫\n");
    await vi.advanceTimersByTimeAsync(2000);
    expect(autoSave.status()).toBe("保存済み");
    expect(autoSave.lastFailure()).toBeUndefined();
    expect([...store.peek(FILE)!]).toEqual([...sjis("本文の猫\r\n")]);
  });
});
