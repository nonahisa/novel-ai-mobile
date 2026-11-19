import { findLatestEpisode, nextChapterNumber, nextDatedName, nextUntitledName, parseEpisodeFileName } from "../shared";
import type { FileStore } from "../platform/fileStore";
import { readWorkLayout, type ScannedWork } from "../platform/workScan";

/**
 * **新しい話**（原稿エディターの上のバーの［…］→ 新しい話。設計書 4.4「［…］：作品と話の操作（新しい話・…）」）。
 *
 * 本体の「話数を追加」（`novelai.addEpisode`）に倣う：
 * - 名前の案：小説などは、いちばん新しい話の名前の流儀で次の番号（`第1話 手紙.txt` → `第3話.txt`、`001.txt` → `003.txt`）。
 *   創作メモ集は「無題」、SNS 記事は今日の日付。作者が窓で書き換えられる
 * - 本体の `nextEpisodeFileNameLike` は vscode に頼る部品（`core/paths`）を通るので借りられない。よくある形
 *   （番号の前の字・番号の桁・番号のすぐ後ろの「話」）だけをここで読む。読めない名前なら 3桁の番号
 * - 名前に使えない字・`.txt` `.md` 以外・同じ名前があれば作らない（本体と同じ断り）
 * - **在るファイルを上書きしない**：`create` で書く（在れば失敗する）。中身は空（小説の雛形は空。本体と同じ）。
 *   作品の種類（台本など）の雛形は、モバイル版がまだ種類を読まないので使わない
 */

const DEFAULT_DIGITS = 3;
const DEFAULT_EXTENSION = ".txt";
const FORBIDDEN = /[/\\:*?"<>|]/;
const EXTENSIONS = [".txt", ".md"];

function extOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot).toLowerCase() : "";
}

function stem(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

/** いちばん新しい話の名前の流儀で、`number` 番の話の名前を作る */
export function nextNameLike(latestFileName: string | null, number: number): string {
  if (!latestFileName) return `${String(number).padStart(DEFAULT_DIGITS, "0")}${DEFAULT_EXTENSION}`;
  const ext = extOf(latestFileName) || DEFAULT_EXTENSION;
  const m = stem(latestFileName).match(/^(\D*?)(\d+)(話)?/);
  if (!m) return `${String(number).padStart(DEFAULT_DIGITS, "0")}${ext}`;
  const [, prefix, digits, wa] = m;
  return `${prefix}${String(number).padStart(digits.length, "0")}${wa ?? ""}${ext}`;
}

function todayKey(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** 新しい話の名前の案 */
export function suggestEpisodeName(work: Pick<ScannedWork, "episodes" | "format">, now = new Date()): string {
  const names = work.episodes.map((e) => e.fileName);
  if (work.format === "memo") return nextUntitledName(names, "無題", ".md");
  const parsed = names.map((name) => parseEpisodeFileName(name));
  if (work.format === "sns") return `${nextDatedName(parsed, todayKey(now))}${DEFAULT_EXTENSION}`;
  const latest = findLatestEpisode(work.episodes);
  return nextNameLike(latest?.fileName ?? null, nextChapterNumber(parsed));
}

/** 名前を確かめる。だめなら理由（窓に出す）。良ければ undefined */
export function checkEpisodeName(raw: string, existing: readonly string[]): string | undefined {
  const name = raw.trim();
  if (!name) return "ファイルの名前を入れてください";
  if (FORBIDDEN.test(name)) return "ファイルの名前に使えない字が入っています";
  if (!EXTENSIONS.includes(extOf(name))) return "名前の終わりは .txt か .md にしてください";
  if (existing.some((other) => other.toLowerCase() === name.toLowerCase())) return "同じ名前の話がもうあります";
  return undefined;
}

/** 本文フォルダーに空の話を作り、置き場の中の場所を返す。在れば作らずに投げる */
export async function createEpisode(store: FileStore, root: string, name: string): Promise<string> {
  const layout = await readWorkLayout(store, root);
  await store.createDirectory(layout.manuscript);
  const path = `${layout.manuscript}/${name.trim()}`;
  await store.writeFile(path, new Uint8Array(), { mode: "create" });
  return path;
}

/** 本文フォルダーの中のファイルの名前（同じ名前を避けるため）。フォルダーが無ければ空 */
export async function manuscriptFileNames(store: FileStore, root: string): Promise<string[]> {
  const layout = await readWorkLayout(store, root);
  return store.listFiles(layout.manuscript).catch(() => []);
}
