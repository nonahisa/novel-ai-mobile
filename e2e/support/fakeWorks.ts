import type { Page } from "@playwright/test";

/**
 * **ブラウザの置き場に作り物の作品を置く**（作品一覧・話の一覧の画面の試験と写真のため）。
 *
 * ブラウザでは Capacitor の Filesystem が IndexedDB（名前 `Disc`、入れ物 `FileStorage`）に書く。
 * 製品に試験用の口を足さないため、その入れ物へ同じ形の記録（`/DATA/works/...`、フォルダーにも記録が要る）を直に置く。
 * 置いたあとで開き直すと、アプリが読む。作品の名前は `_確認用` で終わるもの（作り物）だけにする。
 */

/** 作品一覧と話の一覧で見る作り物の作品 */
export const FAKE_WORKS: Record<string, string> = {
  "灯台守_確認用/.aiwriter/config.json": JSON.stringify({ workTitle: "灯台守の手紙_確認用" }),
  "灯台守_確認用/本文/第1話 手紙.txt": "姉から手紙が届いた。\n// 付箋：ここは後で直す\n",
  "灯台守_確認用/本文/第2話 灯台の階段は百二十段あり、のぼるたびに数え直してしまう.txt": "階段をのぼる。",
  "灯台守_確認用/本文/第3話 霧笛.txt": "霧が出た。",
  "灯台守_確認用/本文/第4話 港.txt": "<<<<<<< ours\n船\n=======\n舟\n>>>>>>> theirs\n",
  "灯台守_確認用/設定/章立て.json": JSON.stringify({
    schemaVersion: "1",
    chapters: [
      { name: "第一章　灯", startEpisodePath: "本文/第1話 手紙.txt" },
      { name: "第二章　港", startEpisodePath: "本文/第3話 霧笛.txt" },
    ],
  }),
  "雨の駅でいつまでも待ち続けている人と、その人を見送る駅員の長い長い物語_確認用/.aiwriter/config.json": "{}",
  "雨の駅でいつまでも待ち続けている人と、その人を見送る駅員の長い長い物語_確認用/本文/第1話.txt": "雨が降る。",
  "壊れた設定_確認用/.aiwriter/config.json": JSON.stringify({ memoMarkers: "percent" }),
  "壊れた設定_確認用/本文/第1話.txt": "猫",
  // 作品ではないもの（縦書きの試しの置き場）は一覧に出ない
  "試し/縦書き.txt": "見本",
};

/** 作り物の作品を置いて、`hash` を開き直す */
export async function openWithWorks(page: Page, hash: string, files: Record<string, string> = FAKE_WORKS): Promise<void> {
  await page.goto("/#/other");
  await page.evaluate(async (entries) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("Disc", 1);
      // アプリがまだ入れ物を作っていなければ、Capacitor と同じ形で作る
      request.onupgradeneeded = () => {
        const store = request.result.createObjectStore("FileStorage", { keyPath: "path" });
        store.createIndex("by_folder", "folder");
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const tx = db.transaction(["FileStorage"], "readwrite");
    const store = tx.objectStore("FileStorage");
    const now = Date.now();
    const folders = new Set<string>();
    for (const [path] of entries) {
      const parts = `DATA/works/${path}`.split("/");
      for (let i = 1; i < parts.length; i += 1) folders.add(`/${parts.slice(0, i).join("/")}`);
    }
    for (const folder of folders) {
      store.put({ path: folder, folder: folder.slice(0, folder.lastIndexOf("/")), type: "directory", size: 0, ctime: now, mtime: now });
    }
    for (const [path, text] of entries) {
      const full = `/DATA/works/${path}`;
      const bytes = new TextEncoder().encode(text);
      let binary = "";
      bytes.forEach((b) => (binary += String.fromCharCode(b)));
      const content = btoa(binary);
      store.put({ path: full, folder: full.slice(0, full.lastIndexOf("/")), type: "file", size: content.length, ctime: now, mtime: now, content });
    }
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }, Object.entries(files));
  await page.goto(`/${hash}`);
}

/** ブラウザの置き場から、作品の中のファイルを読む（無ければ undefined）。`path` は `works/` からの場所 */
export async function readFakeFile(page: Page, path: string): Promise<string | undefined> {
  return page.evaluate(async (relative) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("Disc", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const record = await new Promise<{ content?: string } | undefined>((resolve, reject) => {
      const get = db.transaction(["FileStorage"], "readonly").objectStore("FileStorage").get(`/DATA/works/${relative}`);
      get.onsuccess = () => resolve(get.result as { content?: string } | undefined);
      get.onerror = () => reject(get.error);
    });
    db.close();
    if (!record?.content) return undefined;
    const binary = atob(record.content);
    return new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
  }, path);
}

/** ブラウザの置き場の、`works/` から `prefix` で始まるファイルの場所 */
export async function listFakeFiles(page: Page, prefix: string): Promise<string[]> {
  return page.evaluate(async (start) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("Disc", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const records = await new Promise<{ path: string; type: string }[]>((resolve, reject) => {
      const all = db.transaction(["FileStorage"], "readonly").objectStore("FileStorage").getAll();
      all.onsuccess = () => resolve(all.result as { path: string; type: string }[]);
      all.onerror = () => reject(all.error);
    });
    db.close();
    const head = `/DATA/works/${start}`;
    return records.filter((r) => r.type === "file" && r.path.startsWith(head)).map((r) => r.path.slice("/DATA/works/".length));
  }, prefix);
}
