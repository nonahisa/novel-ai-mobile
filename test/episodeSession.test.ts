import iconv from "iconv-lite";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { VisibilitySource } from "../src/app/autoSave";
import { journalPathFor } from "../src/app/draftJournal";
import { openEpisode } from "../src/app/episodeSession";
import { MemoryFileStore } from "../src/platform/memoryFileStore";
import { RECOVERY_DIRECTORY_NAME } from "../src/platform/textFile";

/**
 * 話を開いて書くあいだの係（`src/app/episodeSession.ts`）。原稿エディター C の土台。
 * 時計は Vitest の偽の時計、置き場は `MemoryFileStore`。作品は作り物（`_確認用`）だけ。
 */

const FILE = "灯台守_確認用/本文/第1話.txt";
const RECOVERY_DIR = `灯台守_確認用/本文/${RECOVERY_DIRECTORY_NAME}`;
const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);
const textOf = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);

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

async function recoveryCount(store: MemoryFileStore): Promise<number> {
  try {
    return (await store.listFiles(RECOVERY_DIR)).length;
  } catch {
    return 0;
  }
}

async function journalText(store: MemoryFileStore, path = FILE): Promise<string | undefined> {
  try {
    return textOf(await store.readFile(journalPathFor(path)));
  } catch {
    return undefined;
  }
}

async function open(initial: Uint8Array = utf8("姉から手紙が届いた。\n")) {
  const store = new MemoryFileStore();
  store.putExternally(FILE, initial);
  const visibility = new FakeVisibility();
  const result = await openEpisode(store, FILE, { visibility });
  if (!result.ok) throw new Error(result.reason);
  return { store, visibility, session: result.session };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("開く", () => {
  test("Shift_JIS・CRLF・末尾の改行の話を開いて閉じても、1バイトも書かない（退避も作らない）", async () => {
    const bytes = new Uint8Array(iconv.encode("姉から手紙が届いた。\r\n灯台の階段。\r\n", "Shift_JIS"));
    const store = new MemoryFileStore();
    store.putExternally(FILE, bytes);
    const writes = vi.spyOn(store, "writeFile");
    const result = await openEpisode(store, FILE, { visibility: new FakeVisibility() });
    if (!result.ok) throw new Error(result.reason);
    const { session } = result;
    // 画面へは読んだ字のまま（LF・末尾の改行あり）
    expect(session.text()).toBe("姉から手紙が届いた。\n灯台の階段。\n");
    // 画面が同じ字を返しても書かない
    session.edit(session.text());
    await vi.advanceTimersByTimeAsync(5000);
    expect(await session.flush()).toBe("保存済み");
    session.dispose();
    await vi.runAllTimersAsync();
    expect(writes).not.toHaveBeenCalled();
    expect([...(await store.readFile(FILE))]).toEqual([...bytes]);
    expect(await recoveryCount(store)).toBe(0);
  });

  test("競合の印のある話は開かない", async () => {
    const store = new MemoryFileStore();
    store.putExternally(FILE, utf8("<<<<<<< ours\n船\n=======\n舟\n>>>>>>> theirs\n"));
    expect(await openEpisode(store, FILE, { visibility: new FakeVisibility() })).toEqual({ ok: false, reason: "conflict_markers" });
  });

  test("無い話は理由を返す（投げない）", async () => {
    const result = await openEpisode(new MemoryFileStore(), FILE, { visibility: new FakeVisibility() });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("unreadable");
  });
});

describe("打って保存する", () => {
  test("止めて2秒で保存し、控えを消す。Shift_JIS・CRLF のまま書く", async () => {
    const store = new MemoryFileStore();
    store.putExternally(FILE, new Uint8Array(iconv.encode("一行目\r\n", "Shift_JIS")));
    const result = await openEpisode(store, FILE, { visibility: new FakeVisibility() });
    if (!result.ok) throw new Error(result.reason);
    const { session } = result;
    session.edit("一行目\n二行目\n");
    expect(session.status()).toBe("保存待ち");
    await vi.advanceTimersByTimeAsync(400);
    // 打った字は控えに先に入る
    expect(await journalText(store)).toBe("一行目\n二行目\n");
    await vi.advanceTimersByTimeAsync(2000);
    expect(session.status()).toBe("保存済み");
    expect(iconv.decode(Buffer.from(await store.readFile(FILE)), "Shift_JIS")).toBe("一行目\r\n二行目\r\n");
    expect(await journalText(store)).toBeUndefined();
    expect(await recoveryCount(store)).toBe(1);
  });

  test("保存できない字（Shift_JIS の ♡）は保存待ちのまま、控えを残す。閉じても残す", async () => {
    const store = new MemoryFileStore();
    store.putExternally(FILE, new Uint8Array(iconv.encode("猫\n", "Shift_JIS")));
    const result = await openEpisode(store, FILE, { visibility: new FakeVisibility() });
    if (!result.ok) throw new Error(result.reason);
    const { session } = result;
    const failures: string[] = [];
    session.onFailure((failure) => failures.push(failure.reason));
    session.edit("猫♡\n");
    expect(await session.flush()).toBe("保存待ち");
    expect(failures).toEqual(["encoding_error"]);
    expect(await journalText(store)).toBe("猫♡\n");
    session.dispose();
    await vi.runAllTimersAsync();
    expect(await journalText(store)).toBe("猫♡\n");
  });

  test("外で変わったら書かずに止め、控えを残す", async () => {
    const { store, session } = await open();
    session.edit("姉から手紙が届いた。妹へ。\n");
    store.putExternally(FILE, utf8("同期で入れ替わった本文\n"));
    expect(await session.flush()).toBe("外で変わりました");
    expect(textOf(await store.readFile(FILE))).toBe("同期で入れ替わった本文\n");
    expect(await journalText(store)).toBe("姉から手紙が届いた。妹へ。\n");
  });

  test("保存した字へ打ち戻したら、控えを消す", async () => {
    const { store, session } = await open();
    session.edit("姉から手紙が届いた。あ\n");
    await vi.advanceTimersByTimeAsync(400);
    expect(await journalText(store)).toBeDefined();
    session.edit("姉から手紙が届いた。\n");
    await vi.runAllTimersAsync();
    expect(await journalText(store)).toBeUndefined();
  });

  test("裏に回ったら、保存と控えをすぐ書く。閉じたら聞き手を外す", async () => {
    const { store, visibility, session } = await open();
    session.edit("姉から手紙が届いた。裏へ。\n");
    visibility.change("hidden");
    await vi.advanceTimersByTimeAsync(0);
    expect(textOf(await store.readFile(FILE))).toBe("姉から手紙が届いた。裏へ。\n");
    session.dispose();
    expect(visibility.size).toBe(0);
  });
});

describe("止められたあと開き直す", () => {
  test("控えが保存した本文と違えば書きかけとして戻し、最初の保存で退避を取ってから書く", async () => {
    const store = new MemoryFileStore();
    store.putExternally(FILE, utf8("姉から手紙が届いた。\n"));
    store.putExternally(journalPathFor(FILE), utf8("姉から手紙が届いた。止められる前の字。\n"));
    const result = await openEpisode(store, FILE, { visibility: new FakeVisibility() });
    if (!result.ok) throw new Error(result.reason);
    const { session } = result;
    expect(session.restored).toBe(true);
    expect(session.text()).toBe("姉から手紙が届いた。止められる前の字。\n");
    expect(session.status()).toBe("保存待ち");
    await vi.advanceTimersByTimeAsync(2500);
    expect(textOf(await store.readFile(FILE))).toBe("姉から手紙が届いた。止められる前の字。\n");
    // 開く前の本文は退避に残る
    const recoveries = await store.listFiles(RECOVERY_DIR);
    expect(recoveries).toHaveLength(1);
    expect(textOf(await store.readFile(`${RECOVERY_DIR}/${recoveries[0]}`))).toBe("姉から手紙が届いた。\n");
    expect(await journalText(store)).toBeUndefined();
  });

  test("控えが保存した本文と同じなら戻さず、控えを消す（書かない）", async () => {
    const store = new MemoryFileStore();
    store.putExternally(FILE, utf8("姉から手紙が届いた。\n"));
    store.putExternally(journalPathFor(FILE), utf8("姉から手紙が届いた。\n"));
    const writes = vi.spyOn(store, "writeFile");
    const result = await openEpisode(store, FILE, { visibility: new FakeVisibility() });
    if (!result.ok) throw new Error(result.reason);
    expect(result.session.restored).toBe(false);
    expect(result.session.status()).toBe("保存済み");
    await vi.runAllTimersAsync();
    expect(writes).not.toHaveBeenCalled();
    expect(await journalText(store)).toBeUndefined();
  });

  test("控えは話ごと（ほかの話の控えを戻さない）", async () => {
    const other = "灯台守_確認用/本文/第2話.txt";
    const store = new MemoryFileStore();
    store.putExternally(FILE, utf8("一\n"));
    store.putExternally(journalPathFor(other), utf8("二話の書きかけ\n"));
    const result = await openEpisode(store, FILE, { visibility: new FakeVisibility() });
    if (!result.ok) throw new Error(result.reason);
    expect(result.session.restored).toBe(false);
    expect(await journalText(store, other)).toBe("二話の書きかけ\n");
  });
});
