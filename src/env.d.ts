/** 取り込んでいる本体の版。`vite.config.ts` の `define` が埋める */
declare const __SHARED_VERSION__: string;

/**
 * VS Code の型 `Thenable`（`PromiseLike` と同じもの）。本体の vscode に頼らない部品
 * （`core/device.ts`・`core/verifiedMemento.ts`）も、この名前を型にだけ使っている。
 * 実行のときには消えるので、型の検査のために名前だけを置く。
 */
type Thenable<T> = PromiseLike<T>;
