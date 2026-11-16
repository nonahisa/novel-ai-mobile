import { describe, expect, test } from "vitest";
import { downloadFont, matchesSpec, readVerifiedFont, sha256Hex, sizeLabel, MINCHO_FONT, type FontShelf, type FontSpec } from "../src/platform/fontDownload";
import { renderFontRow, renderLicenses } from "../src/app/displayScreen";

/** 明朝の書体の取り寄せ（`src/platform/fontDownload.ts`。引継ぎ書 68章）。取り寄せ先は偽物、中身は作り物の数バイト */

const body = new TextEncoder().encode("OTTO 作り物の書体");

async function specFor(bytes: Uint8Array): Promise<FontSpec> {
  return { url: "https://fonts.test/a.otf", size: bytes.length, sha256: await sha256Hex(bytes) };
}

function respond(bytes: Uint8Array, status = 200): Response {
  // 2つに分けて流す（進み具合が2回届く）
  const half = Math.floor(bytes.length / 2);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes.slice(0, half));
      controller.enqueue(bytes.slice(half));
      controller.close();
    },
  });
  return new Response(status === 200 ? stream : null, { status });
}

describe("書体を取り寄せる", () => {
  test("決め打ちの大きさとハッシュに合えば中身を返す。進み具合を知らせる", async () => {
    const spec = await specFor(body);
    const progress: number[] = [];
    const result = await downloadFont(spec, { fetcher: async () => respond(body), onProgress: (loaded) => progress.push(loaded) });
    expect(result.kind).toBe("done");
    expect(result.kind === "done" && [...result.bytes]).toEqual([...body]);
    expect(progress).toEqual([Math.floor(body.length / 2), body.length]);
  });

  test("ハッシュが違う・大きすぎる（途中でやめる）は使わない。404 は失敗。止めたら stopped", async () => {
    const spec = await specFor(body);
    const other = new TextEncoder().encode("OTTO 作り物の書体!"); // 違う中身
    expect(await downloadFont({ ...spec, size: other.length }, { fetcher: async () => respond(other) })).toEqual({ kind: "mismatch" });
    const big = new Uint8Array(spec.size * 3);
    expect(await downloadFont(spec, { fetcher: async () => respond(big) })).toEqual({ kind: "mismatch" });
    expect(await downloadFont(spec, { fetcher: async () => respond(body, 404) })).toEqual({ kind: "failed", status: 404 });
    const abort = new AbortController();
    abort.abort();
    expect(
      await downloadFont(spec, {
        signal: abort.signal,
        fetcher: async () => {
          throw new DOMException("aborted", "AbortError");
        },
      })
    ).toEqual({ kind: "stopped" });
  });

  test("置き場の書体は使う前に毎回照らし、合わなければ消して使わない", async () => {
    const spec = await specFor(body);
    const files = new Map<string, Uint8Array>([["a.otf", body]]);
    const shelf: FontShelf = {
      read: async (name) => files.get(name),
      write: async (name, bytes) => void files.set(name, bytes),
      remove: async (name) => void files.delete(name),
    };
    expect(await readVerifiedFont(shelf, "a.otf", spec)).toEqual(body);
    files.set("a.otf", body.slice(0, 5)); // 書く途中で止められた
    expect(await readVerifiedFont(shelf, "a.otf", spec)).toBeUndefined();
    expect(files.has("a.otf")).toBe(false);
    expect(await matchesSpec(body, spec)).toBe(true);
  });
});

describe("表示の画面", () => {
  test("取り寄せる前に大きさを示す。取り寄せ中は割合と［やめる］。使っていれば印と［消す］", () => {
    expect(sizeLabel(MINCHO_FONT.size)).toBe("6.2MB");
    expect(renderFontRow({ kind: "absent" })).toContain("取り寄せる（6.2MB）");
    expect(renderFontRow({ kind: "downloading", percent: 42 })).toContain(">42%<");
    expect(renderFontRow({ kind: "installed" })).toContain("使っています");
    expect(renderLicenses("SIL OPEN FONT LICENSE <x>")).toContain("SIL OPEN FONT LICENSE &lt;x&gt;");
    expect(renderLicenses("")).toContain("Serif2.003");
  });
});
