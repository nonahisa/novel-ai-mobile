import "../src/platform/bufferShim";
import git from "isomorphic-git";
import { describe, expect, test } from "vitest";
import { removeTree } from "../src/platform/git";
import { MemoryGitFsBackend, createGitFs, normalizeGitPath } from "../src/platform/gitFs";
import { GitBinaryBodyError, asciiBody, createNativeGitHttp } from "../src/platform/gitHttp";
import { bytesToBase64 } from "../src/platform/capacitorFileStore";

/**
 * isomorphic-git の試作（設計書 6章）。ファイルの口は、isomorphic-git を実際に走らせて確かめる
 * （作る・足す・記録する・状態を見る）。通信の口は、端末の側を偽物に替えて形だけ見る。
 * 本物の GitHub からの取得は、エミュレーターの動作確認ページで確かめる（ネットに出ないため）。
 */

const author = { name: "作者", email: "author@example.invalid" };

describe("ファイルの口で isomorphic-git が動く", () => {
  test("作る・足す・記録する・読み戻す（日本語の名前のファイルも）", async () => {
    const backend = new MemoryGitFsBackend();
    const fs = createGitFs(backend);
    const dir = "/作品";
    await fs.promises.mkdir(dir);
    await git.init({ fs, dir, defaultBranch: "main" });
    await fs.promises.mkdir(`${dir}/原稿`);
    await fs.promises.writeFile(`${dir}/原稿/第1話.txt`, "吾輩は猫である。\n");
    await git.add({ fs, dir, filepath: "原稿/第1話.txt" });
    const oid = await git.commit({ fs, dir, message: "第1話を書いた", author });

    const [latest] = await git.log({ fs, dir });
    expect(latest.oid).toBe(oid);
    expect(latest.commit.message.trim()).toBe("第1話を書いた");
    expect(await git.listFiles({ fs, dir })).toEqual(["原稿/第1話.txt"]);
    const { blob } = await git.readBlob({ fs, dir, oid, filepath: "原稿/第1話.txt" });
    expect(new TextDecoder().decode(blob)).toBe("吾輩は猫である。\n");
  });

  test("書き換えたファイルを「変わった」と見分ける（送っていない話の数のもと）", async () => {
    const backend = new MemoryGitFsBackend();
    const fs = createGitFs(backend);
    const dir = "/w";
    await fs.promises.mkdir(dir);
    await git.init({ fs, dir, defaultBranch: "main" });
    await fs.promises.writeFile(`${dir}/a.txt`, "一");
    await git.add({ fs, dir, filepath: "a.txt" });
    await git.commit({ fs, dir, message: "1", author });
    await fs.promises.writeFile(`${dir}/a.txt`, "二");
    const matrix = await git.statusMatrix({ fs, dir });
    // [名前, HEAD, 作業の木, 索引]。2 = 変わった
    expect(matrix).toEqual([["a.txt", 1, 2, 1]]);
  });

  test("【限界】同じ秒のうちに、同じ大きさで書き換えると、isomorphic-git は見分けない", async () => {
    // isomorphic-git は「変わったか」を、大きさと時刻（秒まで）で先に見て、同じなら中身を読まない
    // （`compareStats`）。原稿の1字を同じバイト数の字に替え、記録から1秒以内なら「変わっていない」になる。
    // 製品では、アプリが書いた話をアプリが覚えておき、名指しで足す（git.add）こと。設計書 6章
    const backend = new MemoryGitFsBackend(0);
    const fs = createGitFs(backend);
    const dir = "/w";
    await fs.promises.mkdir(dir);
    await git.init({ fs, dir, defaultBranch: "main" });
    await fs.promises.writeFile(`${dir}/a.txt`, "一");
    await git.add({ fs, dir, filepath: "a.txt" });
    await git.commit({ fs, dir, message: "1", author });
    await fs.promises.writeFile(`${dir}/a.txt`, "二");
    expect(await git.statusMatrix({ fs, dir })).toEqual([["a.txt", 1, 1, 1]]);
    // 名指しで足せば、中身を読んで正しく記録できる
    await git.add({ fs, dir, filepath: "a.txt" });
    expect(await git.statusMatrix({ fs, dir })).toEqual([["a.txt", 1, 2, 2]]);
  });

  test("Node と同じ失敗の印（ENOENT・EEXIST・ENOTEMPTY）を返す", async () => {
    const fs = createGitFs(new MemoryGitFsBackend());
    await expect(fs.promises.readFile("/無い")).rejects.toMatchObject({ code: "ENOENT" });
    await expect(fs.promises.stat("/無い")).rejects.toMatchObject({ code: "ENOENT" });
    await expect(fs.promises.mkdir("/親が無い/子")).rejects.toMatchObject({ code: "ENOENT" });
    await fs.promises.mkdir("/d");
    await expect(fs.promises.mkdir("/d")).rejects.toMatchObject({ code: "EEXIST" });
    await fs.promises.writeFile("/d/f", "x");
    await expect(fs.promises.rmdir("/d")).rejects.toMatchObject({ code: "ENOTEMPTY" });
  });

  test("フォルダーを中身ごと消せる（試作のやり直し）", async () => {
    const backend = new MemoryGitFsBackend();
    const fs = createGitFs(backend);
    await fs.promises.mkdir("/r");
    await git.init({ fs, dir: "/r" });
    await removeTree(backend, "/r");
    expect(await backend.stat("/r")).toBeUndefined();
  });

  test("場所を正規化する", () => {
    expect(normalizeGitPath("a//b/./c/")).toBe("/a/b/c");
    expect(normalizeGitPath("/")).toBe("/");
  });
});

describe("通信の口（端末の側は偽物）", () => {
  async function* chunks(...parts: string[]): AsyncIterableIterator<Uint8Array> {
    for (const part of parts) yield new TextEncoder().encode(part);
  }

  test("取得の本文（ASCII）は文字で送り、2進の答えを読み戻す", async () => {
    const sent: unknown[] = [];
    const http = createNativeGitHttp(async (options) => {
      sent.push(options);
      return {
        status: 200,
        url: options.url,
        headers: { "Content-Type": "application/x-git-upload-pack-result" },
        data: bytesToBase64(new Uint8Array([0, 1, 0xff])),
      };
    });
    const response = await http.request({
      url: "https://github.com/x/y.git/git-upload-pack",
      method: "POST",
      headers: { "content-type": "application/x-git-upload-pack-request" },
      body: chunks("0032want ", "abc\n", "0000"),
    });
    expect(sent[0]).toMatchObject({ method: "POST", data: "0032want abc\n0000", responseType: "arraybuffer" });
    expect(response.statusCode).toBe(200);
    expect(response.headers?.["content-type"]).toBe("application/x-git-upload-pack-result");
    const received: number[] = [];
    for await (const part of response.body!) received.push(...part);
    expect(received).toEqual([0, 1, 0xff]);
  });

  test("2進の本文（送信の版の中身）は、壊して送らずに止める", () => {
    expect(() => asciiBody(new Uint8Array([0x30, 0x80]))).toThrow(GitBinaryBodyError);
  });
});
