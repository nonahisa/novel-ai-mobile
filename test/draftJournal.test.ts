import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  JOURNAL_DELAY_MS,
  JOURNAL_DIRECTORY,
  createDraftJournal,
  journalPathFor,
  decodeJournal,
  encodeJournal,
  restoreDecision,
  shouldRestore,
} from "../src/app/draftJournal";
import { MemoryFileStore } from "../src/platform/memoryFileStore";

/** 書きかけの控え（`src/app/draftJournal.ts`。設計書 5.3 の4） */

const FILE = "作品_確認用/原稿/第1話.txt";
const textOf = (bytes: Uint8Array | undefined): string | undefined => (bytes ? new TextDecoder().decode(bytes) : undefined);

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("書きかけの控え", () => {
  test("控えは作品の外に、話ごとに1つ。名前に原稿の名前を出さない", () => {
    const path = journalPathFor(FILE);
    expect(path.startsWith(`${JOURNAL_DIRECTORY}/`)).toBe(true);
    expect(path).not.toContain("第1話");
    expect(journalPathFor("作品_確認用/原稿/第2話.txt")).not.toBe(path);
    expect(journalPathFor("作品_確認用\\原稿\\第1話.txt")).toBe(path);
  });

  test(`打ったら ${JOURNAL_DELAY_MS}ms 待ってまとめて書く。続けて打てば最後のものだけ`, async () => {
    const store = new MemoryFileStore();
    const journal = createDraftJournal(store, FILE);
    journal.note("吾");
    journal.note("吾輩");
    await vi.advanceTimersByTimeAsync(JOURNAL_DELAY_MS - 1);
    expect(store.peek(journalPathFor(FILE))).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(await journal.read()).toBe("吾輩");
  });

  test("flush() ですぐ書く（裏に回るとき）。書き直しは上書き", async () => {
    const store = new MemoryFileStore();
    const journal = createDraftJournal(store, FILE);
    journal.note("一");
    await journal.flush();
    expect(textOf(store.peek(journalPathFor(FILE)))).toBe("一");
    journal.note("一二");
    await journal.flush();
    expect(textOf(store.peek(journalPathFor(FILE)))).toBe("一二");
    expect(vi.getTimerCount()).toBe(0);
  });

  test("止められたあと、新しく作った控えの係から読める（アプリを開き直したとき）", async () => {
    const store = new MemoryFileStore();
    const before = createDraftJournal(store, FILE);
    before.note("止められる前の書きかけ");
    await before.flush();
    const after = createDraftJournal(store, FILE);
    expect(await after.read()).toBe("止められる前の書きかけ");
  });

  test("clear() で控えを消し、待っていた書きかけも書かない", async () => {
    const store = new MemoryFileStore();
    const journal = createDraftJournal(store, FILE);
    journal.note("一");
    await journal.flush();
    journal.note("一二");
    await journal.clear();
    await vi.advanceTimersByTimeAsync(JOURNAL_DELAY_MS);
    expect(await journal.read()).toBeUndefined();
    // 無いものを消しても失敗しない
    await journal.clear();
  });

  test("書けなかったら知らせ、次の書き込みは止めない", async () => {
    const store = new MemoryFileStore();
    const errors: unknown[] = [];
    let fail = true;
    const original = store.writeFile.bind(store);
    store.writeFile = async (...args) => {
      if (fail) throw new Error("置き場が一杯");
      return original(...args);
    };
    const journal = createDraftJournal(store, FILE, { onError: (error) => errors.push(error) });
    journal.note("一");
    await journal.flush();
    expect(errors).toHaveLength(1);
    fail = false;
    journal.note("二");
    await journal.flush();
    expect(await journal.read()).toBe("二");
  });

  test("開いたときに戻すのは、控えが在り、保存した本文と違うときだけ", () => {
    expect(shouldRestore("書きかけ", "保存した本文")).toBe(true);
    expect(shouldRestore("保存した本文", "保存した本文")).toBe(false);
    expect(shouldRestore(undefined, "保存した本文")).toBe(false);
  });
});

describe("控えのもとになった本文", () => {
  test("添えた行は読むと外れ、もとの本文のハッシュになる。添えていない控えは字のまま", () => {
    const raw = encodeJournal("書きかけ\n", "保存した本文\n");
    expect(raw.startsWith("#novelai-draft base=")).toBe(true);
    expect(decodeJournal(raw)).toEqual({ text: "書きかけ\n", base: expect.stringMatching(/^[0-9a-f]{64}$/) });
    expect(decodeJournal("書きかけ\n")).toEqual({ text: "書きかけ\n" });
    expect(encodeJournal("書きかけ\n", undefined)).toBe("書きかけ\n");
  });

  test("戻し方：無い・同じなら消す・本文が同じなら黙って戻す・変わった／分からないなら訊く", () => {
    const entry = decodeJournal(encodeJournal("書きかけ", "保存した本文"));
    expect(restoreDecision(undefined, "保存した本文")).toBe("none");
    expect(restoreDecision({ text: "保存した本文" }, "保存した本文")).toBe("stale");
    expect(restoreDecision(entry, "保存した本文")).toBe("restore");
    expect(restoreDecision(entry, "入れ替わった本文")).toBe("ask");
    expect(restoreDecision({ text: "書きかけ" }, "保存した本文")).toBe("ask");
  });

  test("base を渡さない係（縦書きの試し）は、控えの頭が同じ形でも字のまま読む", async () => {
    const store = new MemoryFileStore();
    const journal = createDraftJournal(store, FILE);
    journal.note("#novelai-draft base=" + "0".repeat(64) + "\n本文");
    await journal.flush();
    expect(await journal.read()).toBe("#novelai-draft base=" + "0".repeat(64) + "\n本文");
  });
});
