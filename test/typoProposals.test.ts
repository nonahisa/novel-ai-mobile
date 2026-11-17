import { describe, expect, test } from "vitest";
import { MemoryFileStore } from "../src/platform/memoryFileStore";
import { applyProposal } from "../src/platform/applyProposal";
import { parseProposals, proposalId, renderProposals, renderTypoEntry, replaceEpisodeProposals, withoutProposal } from "../src/app/typoProposals";

/** 提案（D）の誤字脱字と、採ったときの当て方（段2）。作品は作り物（`_確認用`） */
const PATH = "works/灯台守_確認用/本文/第1話 手紙.txt";
const FINDING = { path: PATH, line: 2, original: "ししかし姉はいなかった。", target: "ししかし", suggestion: "しかし", reason: "衍字", confidence: "high" as const };
const utf8 = (text: string) => new TextEncoder().encode(text);
const text = async (store: MemoryFileStore) => new TextDecoder().decode(await store.readFile(PATH));

describe("提案の一覧", () => {
  test("走らせ直した話の指摘は入れ替え、同じ指摘は重ねない。ほかの話の指摘は残す", () => {
    const other = { ...FINDING, path: "works/灯台守_確認用/本文/第2話.txt" };
    let list = replaceEpisodeProposals([], "works/灯台守_確認用", PATH, [FINDING, FINDING]);
    list = replaceEpisodeProposals(list, "works/灯台守_確認用", other.path, [other]);
    expect(list).toHaveLength(2);
    list = replaceEpisodeProposals(list, "works/灯台守_確認用", PATH, []);
    expect(list.map((item) => item.path)).toEqual([other.path]);
    expect(withoutProposal(list, proposalId(other))).toEqual([]);
  });

  test("壊れた控えは空。形の違う項目は捨てる", () => {
    expect(parseProposals("{")).toEqual([]);
    expect(parseProposals(JSON.stringify([{ id: 1 }]))).toEqual([]);
  });

  test("話ごとに束ね、直す字に印、［見送る］［採る］", () => {
    const html = renderProposals(replaceEpisodeProposals([], "works/灯台守_確認用", PATH, [FINDING]));
    expect(html).toContain("<h2>第1話 手紙・1件</h2>");
    expect(html).toContain("<mark>ししかし</mark>姉はいなかった。");
    expect(html).toContain(">見送る</button>");
    expect(html).toContain(">採る</button>");
    expect(renderTypoEntry(undefined)).toBe("");
    expect(renderTypoEntry({ root: "works/灯台守_確認用", path: PATH })).toContain("第1話 手紙");
  });
});

describe("採った指摘を本文へ当てる", () => {
  test("元の改行（CRLF）を保ったまま、その字だけを直す。書く前に控えを呼ぶ", async () => {
    const store = new MemoryFileStore();
    store.putExternally(PATH, utf8("灯台の階段を上った。\r\nししかし姉はいなかった。\r\n"));
    const touched: string[] = [];
    const outcome = await applyProposal(store, FINDING, async (path) => void touched.push(path));
    expect(outcome).toEqual({ kind: "applied" });
    expect(await text(store)).toBe("灯台の階段を上った。\r\nしかし姉はいなかった。\r\n");
    expect(touched).toEqual([PATH]);
  });

  test("本文が変わって直す所が無ければ当てない。競合の印のある本文には当てない", async () => {
    const store = new MemoryFileStore();
    store.putExternally(PATH, utf8("灯台の階段を上った。\nしかし姉はいなかった。\n"));
    expect(await applyProposal(store, FINDING)).toEqual({ kind: "stale" });
    const conflicted = new MemoryFileStore();
    conflicted.putExternally(PATH, utf8("<<<<<<< ours\nししかし姉はいなかった。\n=======\nx\n>>>>>>> theirs\n"));
    expect(await applyProposal(conflicted, FINDING)).toEqual({ kind: "conflict" });
    expect(await text(conflicted)).toContain("<<<<<<<");
  });

  test("6回採っても、AI に見せる前の本文は退避に残る（退避は話ごとに最初の1回だけ）", async () => {
    const path = "works/灯台守_確認用/本文/第9話 六回.txt";
    const lines = ["ああ1", "ああ2", "ああ3", "ああ4", "ああ5", "ああ6"];
    const store = new MemoryFileStore();
    store.putExternally(path, utf8(lines.join("\n") + "\n"));
    for (const [index, line] of lines.entries()) {
      const outcome = await applyProposal(store, { ...FINDING, path, line: index + 1, original: line, target: "ああ", suggestion: "いい" });
      expect(outcome).toEqual({ kind: "applied" });
    }
    const recovered: string[] = [];
    const walk = async (dir: string) => {
      for (const [name, kind] of await store.listEntries(dir)) {
        const full = `${dir}/${name}`;
        if (kind === "directory") await walk(full);
        else recovered.push(new TextDecoder().decode(await store.readFile(full)));
      }
    };
    await walk("works/灯台守_確認用/本文/.novelai-recovery").catch(() => walk("works/灯台守_確認用/.novelai-recovery"));
    expect(recovered).toContain(lines.join("\n") + "\n");
    expect(recovered).toHaveLength(1);
  });
});
