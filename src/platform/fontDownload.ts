/**
 * **明朝の書体を取り寄せる**（設計書 5.2【決定】作者 2026-10-31「後から入れられるように」：設定から明朝
 * 〔Noto Serif JP。SIL Open Font License〕を取り寄せて使えるようにする。同梱しない。取り寄せる前に大きさを示す。
 * 取り寄せ先は母艦の決定 2026-11-16：notofonts の GitHub、版を決め打ちして SHA-256 で照らす。引継ぎ書 68章）。
 *
 * - 取り寄せ先は notofonts/noto-cjk のタグ `Serif2.003` の `Serif/SubsetOTF/JP/NotoSerifJP-Regular.otf`
 *   （日本の地域版。日本の字の決まりの字は全部入る。無い字は端末の書体で出る）。`raw.githubusercontent.com` は
 *   CORS を許すので WebView の fetch で取る（2026-11-16 curl で確かめた）
 * - **落としたものの大きさと SHA-256 が決め打ちの値と合わなければ、書かずに捨てる**。書いたあとも、使う前に毎回照らす
 * - 置き場はアプリ専用の領域の `fonts/`（作品の外。同期しない）。通信が無いときも使える
 * - 作者が押したときだけ落とす（モバイル回線の問いの答えが出るまでは、回線を問わず手動だけ。母艦 2026-11-16）
 */

export const MINCHO_FONT = {
  family: "Noto Serif JP",
  label: "明朝（Noto Serif JP）",
  version: "Serif2.003",
  url: "https://raw.githubusercontent.com/notofonts/noto-cjk/Serif2.003/Serif/SubsetOTF/JP/NotoSerifJP-Regular.otf",
  size: 6_210_492,
  sha256: "2c9a12dbd4f2408c4610c7ee84a108b62d7236c3775baed618c64d9cb44b2f04",
  file: "NotoSerifJP-Regular.otf",
  license: "SIL Open Font License 1.1",
  licenseFile: "licenses/NotoSerifJP-OFL.txt",
} as const;

export interface FontSpec {
  url: string;
  size: number;
  sha256: string;
}

/** 置き場（`fonts/` の下）。テストで替える */
export interface FontShelf {
  read(name: string): Promise<Uint8Array | undefined>;
  write(name: string, bytes: Uint8Array): Promise<void>;
  remove(name: string): Promise<void>;
}

export type FontFetch = (url: string, init: { signal?: AbortSignal }) => Promise<Response>;

export type DownloadResult =
  | { kind: "done"; bytes: Uint8Array }
  | { kind: "stopped" }
  /** 届いた中身が決め打ちの大きさ・ハッシュと違う（使わない・書かない） */
  | { kind: "mismatch" }
  | { kind: "failed"; status?: number };

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** 大きさとハッシュが決め打ちの値と同じか */
export async function matchesSpec(bytes: Uint8Array, spec: FontSpec): Promise<boolean> {
  return bytes.length === spec.size && (await sha256Hex(bytes)) === spec.sha256;
}

/** 取り寄せる。進み具合は受け取ったバイト数。照らしてから返す（書くのは呼ぶ側） */
export async function downloadFont(
  spec: FontSpec,
  options: { fetcher?: FontFetch; signal?: AbortSignal; onProgress?: (loaded: number, total: number) => void } = {}
): Promise<DownloadResult> {
  const fetcher = options.fetcher ?? ((url, init) => fetch(url, init));
  let response: Response;
  try {
    response = await fetcher(spec.url, { signal: options.signal });
  } catch {
    return options.signal?.aborted ? { kind: "stopped" } : { kind: "failed" };
  }
  if (!response.ok || !response.body) return { kind: "failed", status: response.status };
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      loaded += value.length;
      // 決め打ちより大きくなったら、それ以上受け取らない
      if (loaded > spec.size) {
        await reader.cancel().catch(() => undefined);
        return { kind: "mismatch" };
      }
      options.onProgress?.(loaded, spec.size);
    }
  } catch {
    return options.signal?.aborted ? { kind: "stopped" } : { kind: "failed" };
  }
  const bytes = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return (await matchesSpec(bytes, spec)) ? { kind: "done", bytes } : { kind: "mismatch" };
}

/** 置き場にあって照らして合う書体のバイト列。無い・合わなければ undefined（合わないものは消す） */
export async function readVerifiedFont(shelf: FontShelf, name: string, spec: FontSpec): Promise<Uint8Array | undefined> {
  let bytes: Uint8Array | undefined;
  try {
    bytes = await shelf.read(name);
  } catch {
    return undefined;
  }
  if (!bytes) return undefined;
  if (await matchesSpec(bytes, spec)) return bytes;
  await shelf.remove(name).catch(() => undefined);
  return undefined;
}

/** 書体を画面で使えるようにする（`--font-ms` などの "Noto Serif JP" がこれを指す） */
export async function useFont(family: string, bytes: Uint8Array, fonts: FontFaceSet = document.fonts): Promise<FontFace> {
  const face = new FontFace(family, bytes as BufferSource);
  await face.load();
  fonts.add(face);
  return face;
}

/** 大きさを作者の字に（6.2MB） */
export function sizeLabel(size: number): string {
  return `${(size / 1_000_000).toFixed(1)}MB`;
}
