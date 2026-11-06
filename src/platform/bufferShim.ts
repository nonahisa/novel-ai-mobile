import { Buffer } from "buffer";

/**
 * isomorphic-git は Node の `Buffer` を名前で使う（`Buffer.from` など）。WebView には無いので、
 * 同じ形の部品（npm の `buffer`）を置く。**isomorphic-git より先に読ませる**ため、
 * `git.ts` の最初の import にする。
 */
const scope = globalThis as { Buffer?: unknown };
scope.Buffer ??= Buffer;
