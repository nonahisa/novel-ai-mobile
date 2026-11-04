/**
 * 本体（統合小説執筆環境の VS Code 拡張機能）と共有する部品の入口。
 *
 * **画面のコードは本体の部品をここから取る。** 本体のファイルを直に
 * あちこちから import すると、どの部品に頼っているかが散らばり、
 * 本体の版を上げたときに確かめる範囲が分からなくなる。
 *
 * 取り込み方は `package.json` の `novel-ai-assistant`（本体のタグを指す依存）。
 * **いつも本体と同じ版で取り込む**（作者の裁定 2026-11-04。`docs/引継ぎ書.md` 2章）。
 * 共有の部品をこちらで直さない。
 */
export {
  parsePostingLedger,
  type PostingLedger,
} from "novel-ai-assistant/src/models/posting";
export {
  postingTextHash,
  postingBodyHash,
} from "novel-ai-assistant/src/core/postingBodyHash";

/** 取り込んでいる本体の版（`vite.config.ts` が本体の package.json から埋める） */
export const SHARED_VERSION: string = __SHARED_VERSION__;
