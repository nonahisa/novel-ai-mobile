import { describe, expect, test } from "vitest";
import { memoMarkersOf } from "../src/shared";
import { MemoryFileStore } from "../src/platform/memoryFileStore";
import { CONFIG_MISSING_MESSAGE, findMarkedLines, readPlotSections, readWorkKindOf, writePlotBasics, writeWorkKind, writeWorkMemoMarkers } from "../src/platform/workSettings";

/**
 * 作品の設定（作品の長押し → 作品の設定。2026-11-21 作者の答え）のうち、設定ファイルに書くメモの印と作品の種類。
 * 作者のデータ（`.aiwriter/config.json`）を書く道なので、本体と同じ守りを試す。作品は作り物（`_確認用`）だけ
 */
const utf8 = (s: string) => new TextEncoder().encode(s);
const text = (store: MemoryFileStore, path: string) => new TextDecoder().decode(store.peek(path)!);
const ROOT = "灯台守_確認用";
const CONFIG = `${ROOT}/.aiwriter/config.json`;

describe("メモの印を書く", () => {
  test("memoMarkers だけを替え、ほかの欄と改行の形（CRLF）は保つ。知らない名前（新しい版の印）は残す", async () => {
    const store = new MemoryFileStore();
    store.putExternally(CONFIG, utf8('{\r\n  "schemaVersion": "0.1",\r\n  "workTitle": "灯台守",\r\n  "memoMarkers": ["slash", "future-mark"],\r\n  "kind": "novel"\r\n}'));
    expect(await writeWorkMemoMarkers(store, ROOT, ["slash", "percent"])).toEqual({ ok: true });
    const after = text(store, CONFIG);
    expect(JSON.parse(after)).toEqual({ schemaVersion: "0.1", workTitle: "灯台守", memoMarkers: ["slash", "percent", "future-mark"], kind: "novel" });
    expect(after).toContain("\r\n");
  });

  test("設定ファイルが無ければ作らずに止め、［題を変える］へ案内する", async () => {
    const store = new MemoryFileStore();
    expect(await writeWorkMemoMarkers(store, ROOT, ["percent"])).toEqual({ ok: false, message: CONFIG_MISSING_MESSAGE });
    expect(store.peek(CONFIG)).toBeUndefined();
  });

  test("壊れた設定ファイルは直さずに止める（書かない）", async () => {
    const store = new MemoryFileStore();
    store.putExternally(CONFIG, utf8("{ 壊れ"));
    expect((await writeWorkMemoMarkers(store, ROOT, ["percent"])).ok).toBe(false);
    expect(text(store, CONFIG)).toBe("{ 壊れ");
  });

  test("1つも選ばなければ書かない", async () => {
    const store = new MemoryFileStore();
    store.putExternally(CONFIG, utf8('{"workTitle":"灯台守"}'));
    expect((await writeWorkMemoMarkers(store, ROOT, [])).ok).toBe(false);
    expect(text(store, CONFIG)).toBe('{"workTitle":"灯台守"}');
  });

  test("新しくオンにする印で始まる行を、話と行で数える。競合の話は読めなかった数に入れる。本文は書き換えない", async () => {
    const store = new MemoryFileStore();
    store.putExternally(CONFIG, utf8('{"workTitle":"灯台守"}'));
    store.putExternally(`${ROOT}/本文/第1話 手紙.txt`, utf8("姉から手紙が届いた。\n%% ここは後で\n本文\n"));
    store.putExternally(`${ROOT}/本文/第2話 霧笛.txt`, utf8("霧が出た。\n"));
    store.putExternally(`${ROOT}/本文/第3話 港.txt`, utf8("<<<<<<< ours\n%% 船\n=======\n舟\n>>>>>>> theirs\n"));
    const found = await findMarkedLines(store, ROOT, memoMarkersOf(["percent"]));
    expect(found.places).toEqual(["第1話 2行目"]);
    expect(found.unreadable).toBe(1);
    expect(text(store, `${ROOT}/本文/第1話 手紙.txt`)).toBe("姉から手紙が届いた。\n%% ここは後で\n本文\n");
  });
});

describe("作品の種類", () => {
  test("書かれていなければ小説。形式が「脚本」なら台本として読む。書くと kind だけを替える", async () => {
    const store = new MemoryFileStore();
    store.putExternally(CONFIG, utf8('{\n  "workTitle": "灯台守"\n}\n'));
    expect(await readWorkKindOf(store, ROOT)).toEqual({ kind: "novel", configured: false });
    store.putExternally(`${ROOT}/設定/plot.md`, utf8("# 灯台守\n\n## 形式\n\n脚本\n"));
    expect((await readWorkKindOf(store, ROOT)).kind).toBe("script");
    expect(await writeWorkKind(store, ROOT, "novel")).toEqual({ ok: true });
    expect(text(store, CONFIG)).toBe('{\n  "workTitle": "灯台守",\n  "kind": "novel"\n}\n');
    expect(await readWorkKindOf(store, ROOT)).toEqual({ kind: "novel", configured: true });
  });

  test("設定ファイルが無ければ種類も書かない", async () => {
    const store = new MemoryFileStore();
    expect(await writeWorkKind(store, ROOT, "script")).toEqual({ ok: false, message: CONFIG_MISSING_MESSAGE });
  });
});

describe("形式・ジャンル（プロットへ書く）", () => {
  const PLOT = `${ROOT}/設定/plot.md`;
  test("形式とジャンルの節だけを書き、作者が書いたほかの節と見出しはそのまま", async () => {
    const store = new MemoryFileStore();
    store.putExternally(CONFIG, utf8('{"workTitle":"灯台守"}'));
    store.putExternally(PLOT, utf8("# 灯台守\n\n## ログライン\n\n姉の手紙を追う。\n\n## 作者のメモ\n\nあとで決める\n"));
    expect(await writePlotBasics(store, ROOT, "長編", "- 現代ドラマ（カクヨム）")).toEqual({ ok: true });
    const after = text(store, PLOT);
    expect(after).toContain("## ログライン\n\n姉の手紙を追う。");
    expect(after).toContain("## 作者のメモ\n\nあとで決める");
    const sections = (await readPlotSections(store, ROOT)).sections;
    expect(sections.format).toBe("長編");
    expect(sections.genre).toBe("- 現代ドラマ（カクヨム）");
  });

  test("ジャンルを決めないまま進んだら、書いてあるジャンルを消さない", async () => {
    const store = new MemoryFileStore();
    store.putExternally(CONFIG, utf8('{"workTitle":"灯台守"}'));
    store.putExternally(PLOT, utf8("# 灯台守\n\n## ジャンル\n\n- 恋愛（カクヨム）\n"));
    expect(await writePlotBasics(store, ROOT, "短編", undefined)).toEqual({ ok: true });
    const sections = (await readPlotSections(store, ROOT)).sections;
    expect(sections.format).toBe("短編");
    expect(sections.genre).toBe("- 恋愛（カクヨム）");
  });

  test("プロットが無ければ、題の見出しと形式の節で作る", async () => {
    const store = new MemoryFileStore();
    store.putExternally(CONFIG, utf8('{"workTitle":"灯台守"}'));
    expect(await writePlotBasics(store, ROOT, "中編", undefined)).toEqual({ ok: true });
    expect(text(store, PLOT)).toMatch(/^# 灯台守/);
    expect((await readPlotSections(store, ROOT)).sections.format).toBe("中編");
  });

  test("形式が「脚本」だった作品は、書き換える前に種類「台本」を作品の設定へ書き留める（設定に種類があれば触らない）", async () => {
    const store = new MemoryFileStore();
    store.putExternally(CONFIG, utf8('{"workTitle":"灯台守"}'));
    store.putExternally(PLOT, utf8("# 灯台守\n\n## 形式\n\n脚本\n"));
    expect(await writePlotBasics(store, ROOT, "長編", undefined)).toEqual({ ok: true });
    expect(JSON.parse(text(store, CONFIG))).toEqual({ workTitle: "灯台守", kind: "script" });
    expect(await readWorkKindOf(store, ROOT)).toEqual({ kind: "script", configured: true });

    const other = new MemoryFileStore();
    other.putExternally(CONFIG, utf8('{"workTitle":"灯台守","kind":"novel"}'));
    other.putExternally(PLOT, utf8("# 灯台守\n\n## 形式\n\n脚本\n"));
    await writePlotBasics(other, ROOT, "長編", undefined);
    expect(JSON.parse(text(other, CONFIG)).kind).toBe("novel");
  });
});
