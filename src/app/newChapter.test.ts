import { describe, expect, it } from "vitest";
import { MemoryFileStore } from "../platform/memoryFileStore";
import { planChapter, saveChapter } from "./newChapter";

const enc = (text: string) => new TextEncoder().encode(text);
const dec = (bytes: Uint8Array | undefined) => (bytes ? new TextDecoder().decode(bytes) : undefined);
const ROOT = "灯台守_確認用";
const FILE = `${ROOT}/設定/章立て.json`;

async function storeWith(chapters?: string): Promise<MemoryFileStore> {
  const store = new MemoryFileStore();
  for (const dir of [`${ROOT}/.aiwriter`, `${ROOT}/本文`, `${ROOT}/設定`]) await store.createDirectory(dir);
  await store.writeFile(`${ROOT}/.aiwriter/config.json`, enc("{}"), { mode: "create" });
  await store.writeFile(`${ROOT}/本文/第1話.txt`, enc("あ"), { mode: "create" });
  if (chapters !== undefined) await store.writeFile(FILE, enc(chapters), { mode: "create" });
  return store;
}

describe("章を立てる（［…］→ 章を立てる。章立ては本体と同じ形）", () => {
  it("章立てが無ければ作る。形は本体と同じ（2字下げの JSON・末に改行）", async () => {
    const store = await storeWith();
    const plan = await planChapter(store, ROOT, `${ROOT}/本文/第3話 港.txt`);
    expect(plan.start).toBe("本文/第3話 港.txt");
    expect(await saveChapter(store, plan, "  第二章　港 ")).toBe("added");
    expect(dec(store.peek(FILE))).toBe(
      `${JSON.stringify({ schemaVersion: "1", chapters: [{ name: "第二章　港", startEpisodePath: "本文/第3話 港.txt" }] }, null, 2)}\n`
    );
  });

  it("その話から始まる章があれば改名。ほかの章は残る", async () => {
    const store = await storeWith(
      JSON.stringify({ schemaVersion: "1", chapters: [{ name: "第一章", startEpisodePath: "本文/第1話.txt" }, { name: "旧", startEpisodePath: "本文/第3話.txt" }] })
    );
    const plan = await planChapter(store, ROOT, `${ROOT}/本文/第3話.txt`);
    expect(plan.current).toBe("旧");
    expect(await saveChapter(store, plan, "第二章")).toBe("renamed");
    expect(JSON.parse(dec(store.peek(FILE))!).chapters).toEqual([
      { name: "第一章", startEpisodePath: "本文/第1話.txt" },
      { name: "第二章", startEpisodePath: "本文/第3話.txt" },
    ]);
  });

  it("壊れた章立ては直さずに止める", async () => {
    const store = await storeWith("{ 壊れた");
    await expect(planChapter(store, ROOT, `${ROOT}/本文/第1話.txt`)).rejects.toThrow();
    expect(dec(store.peek(FILE))).toBe("{ 壊れた");
  });

  it("読んだあとで外で変わっていたら書かない", async () => {
    const store = await storeWith(JSON.stringify({ schemaVersion: "1", chapters: [] }));
    const plan = await planChapter(store, ROOT, `${ROOT}/本文/第1話.txt`);
    await store.writeFile(FILE, enc(JSON.stringify({ schemaVersion: "1", chapters: [{ name: "外", startEpisodePath: "本文/第1話.txt" }] })), { mode: "overwrite" });
    await expect(saveChapter(store, plan, "第一章")).rejects.toThrow("外で変わった");
    expect(dec(store.peek(FILE))).toContain("外");
  });
});
