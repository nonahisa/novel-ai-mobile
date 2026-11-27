import { describe, it } from "vitest";
import { emptyCharacter } from "novel-ai-assistant/src/models/character";
import { emptyLocation } from "novel-ai-assistant/src/models/location";
import { MemoryFileStore } from "../../src/platform/memoryFileStore";
import type { FileStore } from "../../src/platform/fileStore";
import { listWorks, scanWorkFolder } from "../../src/platform/workScan";
import { readWorkTerms } from "../../src/platform/workTerms";

/**
 * 速さの測り（2026-11-27 作者「動作の高速化を念頭に」）。`PERF=1` のときだけ走る（ふだんの試しには入れない）。
 * 端末の置き場は、ファイル1つの読み書きのたびにアプリの中の口を往復する。その往復を `PERF_LATENCY` ms（既定 3）の
 * 遅れでまねる。流し方：`PERF=1 npx vitest run test/perf --silent=false`
 */
const LATENCY = Number(process.env.PERF_LATENCY ?? 3);
const run = process.env.PERF === "1" ? it : it.skip;
const enc = (text: string) => new TextEncoder().encode(text);

class SlowStore implements FileStore {
  calls = 0;
  constructor(private readonly inner: MemoryFileStore) {}
  private async wait<T>(work: () => Promise<T>): Promise<T> {
    this.calls += 1;
    await new Promise((resolve) => setTimeout(resolve, LATENCY));
    return work();
  }
  readFile(path: string) {
    return this.wait(() => this.inner.readFile(path));
  }
  writeFile(path: string, bytes: Uint8Array, options: { mode: "create" | "overwrite" }) {
    return this.wait(() => this.inner.writeFile(path, bytes, options));
  }
  deleteFile(path: string) {
    return this.wait(() => this.inner.deleteFile(path));
  }
  createDirectory(path: string) {
    return this.wait(() => this.inner.createDirectory(path));
  }
  listFiles(path: string) {
    return this.wait(() => this.inner.listFiles(path));
  }
  listEntries(path: string) {
    return this.wait(() => this.inner.listEntries(path));
  }
}

/** 作り物の作品3つ（各60話・1話約2,000字）。作品1には人物40・場所20 */
function works(): MemoryFileStore {
  const store = new MemoryFileStore();
  const body = "姉から手紙が届いた。灯台の灯が、霧の向こうで揺れている。\n".repeat(80);
  for (let w = 1; w <= 3; w++) {
    const root = `作品${w}_確認用`;
    store.putExternally(`${root}/.aiwriter/config.json`, enc(JSON.stringify({ workTitle: `作品${w}` })));
    for (let e = 1; e <= 60; e++) store.putExternally(`${root}/本文/第${e}話 題${e}.txt`, enc(body));
  }
  const set = "作品1_確認用/設定";
  for (let i = 1; i <= 40; i++) {
    const id = `char_${String(i).padStart(3, "0")}`;
    store.putExternally(`${set}/characters/${id}.json`, enc(JSON.stringify(emptyCharacter(id, `人物${i}`))));
  }
  for (let i = 1; i <= 20; i++) {
    const id = `loc_${String(i).padStart(3, "0")}`;
    store.putExternally(`${set}/locations/${id}.json`, enc(JSON.stringify(emptyLocation(id, `場所${i}`))));
  }
  return store;
}

const report = (lines: string[]) => process.stdout.write(["[測り] 遅れ " + LATENCY + "ms", ...lines, ""].join("\n"));

describe("速さの測り", () => {
  run("作品一覧（3作品×60話）と話の一覧（60話）", async () => {
    const lines: string[] = [];
    for (let round = 0; round < 3; round++) {
      const store = new SlowStore(works());
      let start = performance.now();
      await listWorks(store);
      const list = performance.now() - start;
      const listCalls = store.calls;
      store.calls = 0;
      start = performance.now();
      await scanWorkFolder(store, "作品1_確認用");
      const one = performance.now() - start;
      lines.push(`作品一覧 ${list.toFixed(0)}ms（呼び出し ${listCalls}）／話の一覧 ${one.toFixed(0)}ms（呼び出し ${store.calls}）`);
    }
    report(lines);
  }, 120_000);

  run("話を開くときの設定資料（人物40・場所20）", async () => {
    const lines: string[] = [];
    for (let round = 0; round < 3; round++) {
      const store = new SlowStore(works());
      const start = performance.now();
      const terms = await readWorkTerms(store, "作品1_確認用/設定");
      lines.push(`設定資料 ${(performance.now() - start).toFixed(0)}ms（呼び出し ${store.calls}・語 ${terms.entries.length}・読めない ${terms.errors.length}）`);
    }
    report(lines);
  }, 120_000);
});
