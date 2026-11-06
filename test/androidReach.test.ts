import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, test } from "vitest";
import { SHARED_SUBSTITUTIONS } from "../substitutions";

/**
 * 端末（Android・iOS の WebView）で、起動した瞬間に落ちる形になっていないか
 * （設計書 2.4。本体の `test/unit/cross/browserReach.test.ts` にならう）。
 *
 * **静的 import は、呼ばれなくても読み込まれる。** 本体の部品のどこかが
 * `vscode`・`node:` で始まるもの・`undici` を静的に import していると、
 * ビルドが通っても、端末ではアプリを開いた瞬間に落ちる（本体の CLAUDE.md の
 * 「繰り返し起きた失敗」6）。そこで、画面の入口（`src/main.ts`）から
 * **静的 import だけを**たどり、本体の部品（`novel-ai-assistant/...`）の中まで
 * 入って、端末に無いものへ届いていないかを見る。
 *
 * 動的 import（`await import("./x.js")`）は、本体で「動かせるときだけ読む」と
 * 守られた道なので、たどらない（本体の検査と同じ）。
 *
 * 歩き方は本体の `test/unit/support/importGraph.ts` と同じ考えで書いた。
 * 本体のものは本体の `src` だけを歩く作りなので、そのまま借りられない。
 */

const ROOT = path.resolve(__dirname, "..");
const ENTRY = path.join(ROOT, "src", "main.ts");
const SHARED_PACKAGE = "novel-ai-assistant";
const SHARED_ROOT = path.join(ROOT, "node_modules", SHARED_PACKAGE);

/**
 * 端末に無いもの。`path` は `vite.config.ts` で `path-browserify` へ
 * 差し替えているので、ここには入れない（本体のブラウザ版と同じ）。
 */
const DEVICE_MISSING =
  /^(vscode|undici|node:.*|child_process|fs|fs\/promises|os|crypto|worker_threads|net|tls|http|https|stream|zlib)$/;

/** 行頭の静的な `import`・再輸出だけを拾う。`import type` は実行時に消えるので除く */
const STATIC_IMPORT =
  /^import\s+(?!type\s)([\s\S]*?)\s+from\s+["']([^"']+)["']|^import\s+["']([^"']+)["']|^export\s+(?!type\s)(?:\*|\{[\s\S]*?\})\s+from\s+["']([^"']+)["']/gm;

/** 画面の組み立てにしか効かないもの（CSS など）は、たどらない */
const NOT_CODE = /\.(css|svg|png|json)$/;

function resolveFile(base: string): string | undefined {
  const plain = base.replace(/\.js$/, "");
  for (const candidate of [plain, `${plain}.ts`, path.join(plain, "index.ts")]) {
    if (candidate.endsWith(".ts") && fs.existsSync(candidate)) return candidate;
  }
  return undefined;
}

/**
 * 本体の部品の中から読まれたときに、モバイル版の部品へ差し替わるもの（`substitutions.ts`）。
 * 組み立て（`vite.config.ts`）と同じ一覧で差し替えて歩く。そうしないと、
 * 端末では読まれない本体の元の部品を見張ってしまう
 */
const SUBSTITUTED = new Map(
  Object.entries(SHARED_SUBSTITUTIONS).map(([from, to]) => [
    path.join(SHARED_ROOT, from),
    path.join(ROOT, to),
  ])
);

/** たどる相手のファイル。たどらないもの（Capacitor の部品など）は `undefined` */
function resolveImport(fromFile: string, spec: string): string | undefined {
  if (spec.startsWith(".")) {
    const target = path.resolve(path.dirname(fromFile), spec).replace(/\.(js|ts)$/, "");
    if (fromFile.startsWith(SHARED_ROOT)) {
      const substitute = SUBSTITUTED.get(target);
      if (substitute) return substitute;
    }
    return resolveFile(target);
  }
  if (spec.startsWith(`${SHARED_PACKAGE}/`)) {
    return resolveFile(path.join(SHARED_ROOT, spec.slice(SHARED_PACKAGE.length + 1)));
  }
  return undefined;
}

interface Reach {
  files: Set<string>;
  bare: { file: string; spec: string }[];
  unresolved: { file: string; spec: string }[];
}

function walkStaticImports(entry: string): Reach {
  const files = new Set([entry]);
  const bare: Reach["bare"] = [];
  const unresolved: Reach["unresolved"] = [];
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.shift()!;
    const source = fs.readFileSync(file, "utf8");
    for (const match of source.matchAll(STATIC_IMPORT)) {
      const spec = match[2] ?? match[3] ?? match[4];
      if (!spec || NOT_CODE.test(spec)) continue;
      const isShared = spec.startsWith(`${SHARED_PACKAGE}/`);
      if (!spec.startsWith(".") && !isShared) {
        bare.push({ file, spec });
        continue;
      }
      const next = resolveImport(file, spec);
      if (!next) {
        unresolved.push({ file, spec });
        continue;
      }
      if (files.has(next)) continue;
      files.add(next);
      queue.push(next);
    }
  }
  return { files, bare, unresolved };
}

const name = (file: string): string => path.relative(ROOT, file).replace(/\\/g, "/");

describe("端末で起動した瞬間に落ちないか（androidReach）", () => {
  const reached = walkStaticImports(ENTRY);

  test("端末に無いもの（vscode・node:・undici など）へ、静的 import で届いていない", () => {
    // 落ちたら：本体の部品が端末に無いものを静的に読んでいる。
    // こちらで直さず（共有の部品は写さない・直さない）、母艦へ伝えて本体で直してもらう
    const offenders = reached.bare
      .filter((entry) => DEVICE_MISSING.test(entry.spec))
      .map((entry) => `${name(entry.file)} -> ${entry.spec}`);
    expect(offenders).toEqual([]);
  });

  test("たどれない import が無い（たどり方が壊れていない）", () => {
    expect(reached.unresolved.map((entry) => `${name(entry.file)} -> ${entry.spec}`)).toEqual([]);
  });

  test("検査が空振りしていない（本体の部品の中まで入っている）", () => {
    // たどり方が壊れて入口だけになっても、上の検査は通ってしまう
    const sharedFiles = [...reached.files].filter((file) => file.startsWith(SHARED_ROOT));
    expect(sharedFiles.length).toBeGreaterThan(3);
    expect(sharedFiles.map(name)).toContain(
      "node_modules/novel-ai-assistant/src/models/posting.ts"
    );
  });

  test("差し替えた部品の道を歩いている（AI への通信は本体の fetchTimeouts を読まない）", () => {
    const names = [...reached.files].map(name);
    expect(names).toContain("node_modules/novel-ai-assistant/src/ai/httpClient.ts");
    expect(names).toContain("src/platform/fetchTimeouts.ts");
    expect(names).not.toContain("node_modules/novel-ai-assistant/src/ai/fetchTimeouts.ts");
  });

  test("見張りが当たる（端末に無いものを読む本体の部品を、実際に咎める）", () => {
    // 本体の `core/postingStore.ts` は `vscode` を読む（モバイル版では差し替える部品。設計書 2.3）。
    // ここから歩けば、必ず咎めなければならない
    const store = path.join(SHARED_ROOT, "src", "core", "postingStore.ts");
    const fromStore = walkStaticImports(store);
    expect(fromStore.bare.some((entry) => entry.spec === "vscode")).toBe(true);
  });
});
