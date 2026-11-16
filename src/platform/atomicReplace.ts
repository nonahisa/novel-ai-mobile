/**
 * **在るファイルを、途中で止められても半分にならない形で書き換える**（本体 `atomicWrite.ts` の
 * 「一時ファイルに書く → 名前の変更で置く → 置いたあとに確かめる」にそろえる。引継ぎ書 62章）。
 *
 * Capacitor の `writeFile` は元のファイルを空にしてから書く（Android の部品 `saveFile` は
 * `FileOutputStream` で書くだけ）。書いている途中でアプリが止められると、原稿が途中で切れたまま残る。
 *
 * 1. 同じフォルダーの退避のフォルダー（`.novelai-recovery`。送らない・数えない）に一時ファイルを書く
 * 2. 一時ファイルを、元のファイルの名前へ変える（Android は在るファイルを置き換える。2026-11-16 エミュレーターで確かめた）
 * 3. 名前の変更が「在る」で断られたら（iOS の部品の振る舞いは確かめていない）、元を消してから名前を変える。
 *    消してから置くまでの隙に止められても、書いた中身は一時ファイルに丸ごと残る
 * 4. 置いたあとに読み直して、書いたバイトと同じかを確かめる
 *
 * 置く前に失敗したら一時ファイルを消す（元のファイルには触れていない）。
 */

export interface ReplaceOps {
  write(path: string, bytes: Uint8Array): Promise<void>;
  read(path: string): Promise<Uint8Array>;
  rename(from: string, to: string): Promise<void>;
  remove(path: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  mkdir(path: string): Promise<void>;
}

export class ReplaceError extends Error {
  constructor(
    message: string,
    /** 書いた中身が丸ごと残っている一時ファイル（置けなかったとき） */
    readonly leftover?: string
  ) {
    super(message);
    this.name = "ReplaceError";
  }
}

const TEMP_DIRECTORY = ".novelai-recovery";

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i += 1) if (left[i] !== right[i]) return false;
  return true;
}

function randomName(): string {
  const uuid = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `.tmp-${uuid}`;
}

/** 一時ファイルの置き場（元と同じフォルダーの退避のフォルダー） */
export function tempPathFor(path: string, name = randomName()): string {
  const slash = path.lastIndexOf("/");
  const folder = slash >= 0 ? path.slice(0, slash) : "";
  return `${folder ? `${folder}/` : ""}${TEMP_DIRECTORY}/${name}`;
}

export async function replaceViaTemp(ops: ReplaceOps, path: string, bytes: Uint8Array): Promise<void> {
  const temp = tempPathFor(path);
  await ops.mkdir(temp.slice(0, temp.lastIndexOf("/")));
  try {
    await ops.write(temp, bytes);
  } catch (error) {
    await ops.remove(temp).catch(() => undefined);
    throw error;
  }
  try {
    await ops.rename(temp, path);
  } catch (first) {
    // 名前の変更が「在る」で断られた（iOS など）。元を消してから置く
    if (!(await ops.exists(temp))) throw first;
    if (await ops.exists(path)) {
      try {
        await ops.remove(path);
      } catch (error) {
        await ops.remove(temp).catch(() => undefined);
        throw error;
      }
    }
    try {
      await ops.rename(temp, path);
    } catch {
      throw new ReplaceError(`書き換えを置けませんでした。書いた中身は「${temp}」に残っています`, temp);
    }
  }
  let placed: Uint8Array;
  try {
    placed = await ops.read(path);
  } catch {
    throw new ReplaceError("書き換えたあとに読み直せませんでした");
  }
  if (!sameBytes(placed, bytes)) throw new ReplaceError("書き換えたあとの中身が、書いたものと違います");
}
