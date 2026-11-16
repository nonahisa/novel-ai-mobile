import "../src/platform/bufferShim";
import { Errors } from "isomorphic-git";
import { describe, expect, test } from "vitest";
import { MemoryGitFsBackend } from "../src/platform/gitFs";
import { importWork, importableName, listGithubRepos, type CloneFn, type Fetcher, type GithubRepo } from "../src/platform/workImport";
import { failureText, renderImportView } from "../src/app/importScreen";

/** 作品を GitHub から取り寄せる（`src/platform/workImport.ts`。引継ぎ書 65章）。GitHub は偽物。合言葉は作り物 */

const repo = (name: string, extra: Partial<GithubRepo> = {}): GithubRepo => ({ owner: "sakka", name, private: true, defaultBranch: "main", ...extra });
const apiRepo = (name: string) => ({ name, owner: { login: "sakka" }, private: true, default_branch: "main", pushed_at: "2026-11-16T10:00:00Z" });

describe("リポジトリの一覧", () => {
  test("合言葉は Authorization の頭にだけ。100件ずつ頁をめくり、最近送った順のまま並べる", async () => {
    const urls: string[] = [];
    const fetcher: Fetcher = async (url, init) => {
      urls.push(url);
      expect(init.headers.Authorization).toBe("Bearer tkn");
      const page = Number(new URL(url).searchParams.get("page"));
      const items = page === 1 ? Array.from({ length: 100 }, (_, i) => apiRepo(`作品${i}`)) : [apiRepo("toudai")];
      return { status: 200, json: async () => items };
    };
    const result = await listGithubRepos("tkn", fetcher, "https://api.test");
    expect(result.kind === "repos" && result.repos.length).toBe(101);
    expect(result.kind === "repos" && result.repos[100]).toEqual({ owner: "sakka", name: "toudai", private: true, defaultBranch: "main", pushedAt: Date.parse("2026-11-16T10:00:00Z") });
    expect(urls).toHaveLength(2);
    expect(urls.join(" ")).not.toContain("tkn");
  });

  test("401 はサインインし直す・届かない・権限が無い", async () => {
    expect(await listGithubRepos("tkn", async () => ({ status: 401, json: async () => ({}) }))).toEqual({ kind: "failed", reason: "sign_in_again" });
    expect(
      await listGithubRepos("tkn", async () => {
        throw new TypeError("Failed to fetch");
      })
    ).toEqual({ kind: "failed", reason: "offline" });
    expect(await listGithubRepos("tkn", async () => ({ status: 403, json: async () => ({}) }))).toEqual({ kind: "failed", reason: "no_access" });
    expect(failureText("sign_in_again")).toContain("サインインし直して");
  });
});

describe("取り寄せる", () => {
  test("置き場の直下にリポジトリの名前で取り寄せる。URL に合言葉は入れず、合言葉は別に渡す", async () => {
    const backend = new MemoryGitFsBackend();
    const seen: Array<{ dir: string; url: string; ref: string; token: string }> = [];
    const clone: CloneFn = async ({ fs, dir, url, ref, token }) => {
      seen.push({ dir, url, ref, token });
      await fs.promises.mkdir(dir);
      await fs.promises.writeFile(`${dir}/本文.txt`, "一\n");
    };
    expect(await importWork({ backend, repo: repo("toudai", { defaultBranch: "draft" }), token: "tkn", base: "", clone })).toEqual({ kind: "imported", root: "toudai" });
    expect(seen).toEqual([{ dir: "/toudai", url: "https://github.com/sakka/toudai.git", ref: "draft", token: "tkn" }]);
  });

  test("同じ名前のフォルダーが在れば取り寄せない（手元の作品を上書きしない）。`.` で始まる名前は置かない", async () => {
    const backend = new MemoryGitFsBackend();
    await backend.mkdir("/toudai");
    await backend.writeFile("/toudai/手元.txt", new TextEncoder().encode("手元の原稿\n"));
    let called = false;
    const clone: CloneFn = async () => {
      called = true;
    };
    expect(await importWork({ backend, repo: repo("toudai"), token: "tkn", clone })).toEqual({ kind: "exists", root: "toudai" });
    expect(called).toBe(false);
    expect(new TextDecoder().decode(await backend.readFile("/toudai/手元.txt"))).toBe("手元の原稿\n");
    expect(await importWork({ backend, repo: repo(".github"), token: "tkn", clone })).toEqual({ kind: "bad_name" });
    expect(importableName("toudai")).toBe(true);
  });

  test("途中で失敗したら作りかけのフォルダーを消し、失敗の種類を返す", async () => {
    const backend = new MemoryGitFsBackend();
    const clone: CloneFn = async ({ fs, dir }) => {
      await fs.promises.mkdir(dir);
      await fs.promises.writeFile(`${dir}/半分.txt`, "途中");
      throw new Errors.HttpError(401, "Unauthorized", "");
    };
    expect(await importWork({ backend, repo: repo("toudai"), token: "tkn", clone })).toEqual({ kind: "failed", reason: "sign_in_again" });
    expect(await backend.stat("/toudai")).toBeUndefined();
  });
});

test("画面：取り寄せ済みの行は押せず印。ほかは押せる。サインインしていなければサインインへ", () => {
  const html = renderImportView({ kind: "repos", repos: [repo("toudai"), repo("ame")], existing: new Set(["toudai"]) });
  expect(html).toContain(`<div class="ep" aria-disabled="true"><span class="no"></span><span class="name">toudai</span><span class="chars"><span class="flag ok">取り寄せ済み</span>`);
  expect(html).toContain(`data-import="sakka/ame"`);
  expect(renderImportView({ kind: "signedOut" })).toContain(`data-screen="github"`);
});
