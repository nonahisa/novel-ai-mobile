import type { createGitFs } from "./gitFs";

/**
 * **アプリが書いた話の控え（名指し）**（引継ぎ書 61章）。
 *
 * isomorphic-git は「変わったか」を大きさと時刻（秒まで）で先に見るので、同じ秒に同じ大きさで書き換えると
 * 見落とす（`test/git.test.ts` の【限界】）。原稿エディターが保存する直前に、その話をここに控え、
 * 送っていない話を数えるとき・送るとき・取り込むときに名指しで渡す（`collectChanges` の `touched`。
 * 名指しした話は中身を読んで HEAD と比べるので、変わっていなければ拾わない＝控えが余っても害は無い）。
 *
 * - 置き場はリポジトリの `.git/novelai-touched.json`（端末の中だけ。送らない）。道はリポジトリの中の道
 * - **書く前に控える**（控えたあとで書けなくても、余るだけ。書いたあとで控えられないと見落とす）
 * - 送れたら、送った作品の控えを消す
 * - 読めない・壊れた控えは空とみなす（数えるのを止めない）
 */

type GitFs = ReturnType<typeof createGitFs>;

const FILE = "novelai-touched.json";

export async function readTouched(fs: GitFs, dir: string): Promise<string[]> {
  try {
    const parsed = JSON.parse((await fs.promises.readFile(`${dir}/.git/${FILE}`, "utf8")) as string) as unknown;
    return Array.isArray(parsed) ? parsed.filter((path): path is string => typeof path === "string" && path !== "") : [];
  } catch {
    return [];
  }
}

async function writeTouched(fs: GitFs, dir: string, paths: readonly string[]): Promise<void> {
  if (paths.length === 0) {
    await fs.promises.unlink(`${dir}/.git/${FILE}`).catch(() => undefined);
    return;
  }
  await fs.promises.writeFile(`${dir}/.git/${FILE}`, JSON.stringify([...paths].sort()));
}

/** 1つの控えを足す（リポジトリが git でなければ何もしない） */
export async function noteTouched(fs: GitFs, dir: string, path: string): Promise<void> {
  try {
    await fs.promises.stat(`${dir}/.git`);
  } catch {
    return;
  }
  const paths = await readTouched(fs, dir);
  if (paths.includes(path)) return;
  await writeTouched(fs, dir, [...paths, path]);
}

/** 控えを消す（`keep` が true の道は残す。書庫の中のほかの作品の控えなど） */
export async function forgetTouched(fs: GitFs, dir: string, keep: (path: string) => boolean = () => false): Promise<void> {
  const paths = await readTouched(fs, dir);
  const left = paths.filter(keep);
  if (left.length !== paths.length) await writeTouched(fs, dir, left);
}

/**
 * 置き場の道（`作品/本文/第1話.txt`・`書庫/作品/本文/第1話.txt`）を、リポジトリ（置き場の直下のフォルダー）と
 * その中の道に分ける。直下のファイルは undefined
 */
export function splitStorePath(storePath: string): { repo: string; path: string } | undefined {
  const slash = storePath.indexOf("/");
  if (slash <= 0 || slash === storePath.length - 1) return undefined;
  return { repo: storePath.slice(0, slash), path: storePath.slice(slash + 1) };
}

/** 書き込みを1つずつ並べて控える係（打鍵ごとの保存が重なっても、控えを書き違えない） */
export function createTouchedRecorder(fs: GitFs, base = ""): (storePath: string) => Promise<void> {
  let queue: Promise<void> = Promise.resolve();
  return (storePath) => {
    const split = splitStorePath(storePath);
    if (!split) return queue;
    const run = () => noteTouched(fs, `${base}/${split.repo}`, split.path).catch(() => undefined);
    queue = queue.then(run, run);
    return queue;
  };
}
