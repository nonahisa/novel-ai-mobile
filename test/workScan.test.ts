import "../src/platform/bufferShim";
import git from "isomorphic-git";
import { describe, expect, test } from "vitest";
import { MemoryFileStore } from "../src/platform/memoryFileStore";
import { MemoryGitFsBackend, createGitFs } from "../src/platform/gitFs";
import { lastCommitTime } from "../src/platform/git";
import { findWorkRoots, listWorks, scanWorkFolder } from "../src/platform/workScan";
import { dayLabel, episodeListRows, mobileWording, workCard, workSummary } from "../src/app/workListView";
import { GitFsFileStore } from "./support/gitFsFileStore";

/**
 * 作品一覧（A）と話の一覧（B）の中身（設計書 4.2）。本体の走査（`core/scanner.ts`）と同じ決まりで読めるか。
 * 作品は作り物（名前は `_確認用` で終わる）だけで試す
 */
const enc = (text: string) => new TextEncoder().encode(text);
const WORK = "灯台守_確認用";

function put(store: MemoryFileStore, files: Record<string, string>): MemoryFileStore {
  for (const [path, text] of Object.entries(files)) store.putExternally(path, enc(text));
  return store;
}

/** `.aiwriter/config.json` を持つ作品（新しく作った形） */
function work(root: string, files: Record<string, string>, config: object | string = { workTitle: "灯台守の手紙" }): Record<string, string> {
  const out: Record<string, string> = { [`${root}/.aiwriter/config.json`]: typeof config === "string" ? config : JSON.stringify(config) };
  for (const [path, text] of Object.entries(files)) out[`${root}/${path}`] = text;
  return out;
}

describe("作品のフォルダーを見つける", () => {
  test(".git か .aiwriter を持つ直下のフォルダーだけ（試し・動作確認の取得・控えは作品にしない）", async () => {
    const store = put(new MemoryFileStore(), {
      ...work("B_確認用", { "本文/第1話.txt": "猫" }),
      "A_確認用/.git/HEAD": "ref: refs/heads/main\n",
      "A_確認用/本文/第1話.txt": "犬",
      "試し/縦書き.txt": "見本",
      "確認_git/novel-ai-mobile/.git/HEAD": "ref: refs/heads/main\n",
      ".novelai-drafts/abc.txt": "書きかけ",
      "ただのフォルダー/第1話.txt": "鳥",
    });
    expect(await findWorkRoots(store)).toEqual(["A_確認用", "B_確認用"]);
  });

  test("置き場が空なら作品は無い", async () => {
    expect(await listWorks(new MemoryFileStore())).toEqual([]);
  });

  test("書庫（作品を並べた1つのリポジトリ）は、中の作品を1つずつ作品にする", async () => {
    const store = put(new MemoryFileStore(), {
      "書庫_確認用/.git/HEAD": "ref: refs/heads/main\n",
      "書庫_確認用/.aiwriter/logs/sync.log": "",
      ...work("書庫_確認用/甲_確認用", { "本文/第1話.txt": "猫" }),
      ...work("書庫_確認用/乙_確認用", { "本文/第1話.txt": "犬" }),
      "書庫_確認用/README.md": "# 書庫",
    });
    expect(await findWorkRoots(store)).toEqual(["書庫_確認用/乙_確認用", "書庫_確認用/甲_確認用"]);
    const items = await listWorks(store);
    expect(items.map((item) => item.ok && item.work.episodes.length)).toEqual([1, 1]);
  });
});

describe("1作品を読む（本体の走査と同じ決まり）", () => {
  test("話は話数の順・作品情報と根の README は話に数えない・題は作品の設定から", async () => {
    const store = put(
      new MemoryFileStore(),
      work(WORK, {
        "本文/第10話 霧笛.txt": "霧が出た。",
        "本文/第2話 舟.txt": "舟を漕ぐ。",
        "本文/第1話 手紙.txt": "手紙が届く。",
        "本文/about.txt": "【作品タイトル】\n灯台守の手紙\n【あらすじ】\n灯台の話\n",
        "README.md": "# 作品",
      })
    );
    const scanned = await scanWorkFolder(store, WORK);
    expect(scanned.title).toBe("灯台守の手紙");
    expect(scanned.episodes.map((e) => e.fileName)).toEqual(["第1話 手紙.txt", "第2話 舟.txt", "第10話 霧笛.txt"]);
    expect(scanned.stats.episodeCount).toBe(3);
    expect(scanned.stats.totals.net).toBe(6 + 5 + 5);
    const rows = episodeListRows(scanned);
    expect(rows[0]).toMatchObject({ type: "episode", no: "第1話", name: "手紙", chars: "6字" });
    expect(workSummary(scanned)).toBe("3話・16字");
  });

  test("題が無ければフォルダーの名前。本文フォルダーが空で根に原稿があれば根を読む（本体と同じ）", async () => {
    const store = put(new MemoryFileStore(), {
      [`${WORK}/.git/HEAD`]: "ref: refs/heads/main\n",
      [`${WORK}/第1話.txt`]: "根の原稿",
      [`${WORK}/LICENSE`]: "MIT",
      [`${WORK}/README.md`]: "説明",
    });
    await store.createDirectory(`${WORK}/本文`);
    const scanned = await scanWorkFolder(store, WORK);
    expect(scanned.title).toBe(WORK);
    expect(scanned.episodes.map((e) => e.fileName)).toEqual(["第1話.txt"]);
  });

  test("字数は作品のメモの印を読んで数える（既定の // と、作品が選んだ %%）", async () => {
    const body = "猫が鳴く\n// 既定の付箋\n%% 選んだ付箋です\n";
    const plain = await scanWorkFolder(put(new MemoryFileStore(), work(WORK, { "本文/第1話.txt": body })), WORK);
    const percent = await scanWorkFolder(
      put(new MemoryFileStore(), work(WORK, { "本文/第1話.txt": body }, { workTitle: "灯台守の手紙", memoMarkers: ["percent"] })),
      WORK
    );
    // 既定では // の行を数えず %% の行を数える。%% を選んだ作品では逆
    expect(plain.stats.totals.net).not.toBe(percent.stats.totals.net);
    const onlyCat = await scanWorkFolder(put(new MemoryFileStore(), work(WORK, { "本文/第1話.txt": "猫が鳴く\n" })), WORK);
    expect(plain.stats.totals.net).toBe(onlyCat.stats.totals.net + "%% 選んだ付箋です".replace(/\s/g, "").length);
    expect(percent.stats.totals.net).toBe(onlyCat.stats.totals.net + "// 既定の付箋".replace(/\s/g, "").length);
  });

  test("競合の印のある話は字数に入れず、印を付ける", async () => {
    const store = put(
      new MemoryFileStore(),
      work(WORK, {
        "本文/第1話.txt": "猫",
        "本文/第2話.txt": "<<<<<<< ours\n犬\n=======\n鳥\n>>>>>>> theirs\n",
      })
    );
    const scanned = await scanWorkFolder(store, WORK);
    expect(scanned.stats).toMatchObject({ episodeCount: 2, conflictedCount: 1 });
    expect(scanned.stats.totals.net).toBe(1);
    expect(episodeListRows(scanned)[1]).toMatchObject({ conflict: true });
    expect(workCard({ ok: true, work: scanned }, new Date()).flags).toEqual([{ text: "競合：1話", tone: "shu" }]);
  });

  test("名前に % や %25 がある原稿も読み、章立ての開始の話に当たる", async () => {
    const chapters = { chapters: [{ name: "第一章", startEpisodePath: "本文/第2話 100%25.txt" }] };
    const store = put(
      new MemoryFileStore(),
      work(WORK, { "本文/第1話 50%.txt": "猫", "本文/第2話 100%25.txt": "犬犬", "設定/章立て.json": JSON.stringify(chapters) })
    );
    const scanned = await scanWorkFolder(store, WORK);
    expect(scanned.episodes.map((e) => [e.fileName, e.counts.net])).toEqual([
      ["第1話 50%.txt", 1],
      ["第2話 100%25.txt", 2],
    ]);
    expect(episodeListRows(scanned).map((row) => row.type)).toEqual(["episode", "chapter", "episode"]);
  });

  test("Shift_JIS の原稿も字数を数える", async () => {
    const store = put(new MemoryFileStore(), work(WORK, {}));
    // 「猫」の Shift_JIS（0x944C）
    store.putExternally(`${WORK}/本文/第1話.txt`, new Uint8Array([0x94, 0x4c, 0x94, 0x4c]));
    expect((await scanWorkFolder(store, WORK)).stats.totals.net).toBe(2);
  });
});

describe("壊れた設定は、その作品だけ止める（本体と同じ）", () => {
  test("作品の設定が JSON でない・メモの印が壊れている・本文の置き場が外を指す", async () => {
    const store = put(new MemoryFileStore(), {
      ...work("A_確認用", { "本文/第1話.txt": "猫" }),
      ...work("B_確認用", { "本文/第1話.txt": "猫" }, "{壊れた"),
      ...work("C_確認用", { "本文/第1話.txt": "猫" }, { workTitle: "C", memoMarkers: "percent" }),
      ...work("D_確認用", { "本文/第1話.txt": "猫" }, { workTitle: "D", manuscriptDir: "../外" }),
    });
    const items = await listWorks(store);
    expect(items.map((item) => [item.ok, item.ok ? item.work.root : item.root])).toEqual([
      [true, "A_確認用"],
      [false, "B_確認用"],
      [false, "C_確認用"],
      [false, "D_確認用"],
    ]);
    for (const item of items.slice(1)) {
      expect(item.ok).toBe(false);
      if (!item.ok) expect(item.error).toMatch(/^作品設定を読み込めません/);
    }
    // 読めない作品は字数を出さない（0字と出すと「書いていない」と読める）
    const card = workCard(items[1], new Date());
    expect(card.meta).toEqual([]);
    expect(card.flags[0].text).toMatch(/^⚠ 作品設定を読み込めません/);
  });

  test("パソコンの画面を指す言い回しは、モバイル版の言い方に置き換える（2026-11-16 作者の答え）", async () => {
    const store = put(new MemoryFileStore(), work("C_確認用", { "本文/第1話.txt": "猫" }, { workTitle: "C", memoMarkers: "percent" }));
    const [item] = await listWorks(store);
    expect(item.ok).toBe(false);
    if (!item.ok) expect(item.error).toContain("詳細メニューの作品別設定");
    const text = workCard(item, new Date()).flags[0].text;
    expect(text).not.toContain("詳細メニュー");
    expect(text).toContain("パソコンで作品別設定の「メモの印」を選び直してから、同期してください");
    expect(mobileWording("詳細メニューから選びます")).toBe("パソコンの詳細メニューから選びます");
    expect(mobileWording("パソコンの詳細メニュー")).toBe("パソコンの詳細メニュー");
  });
});

describe("章ごとに並べる（設定/章立て.json）", () => {
  const files = {
    "本文/第1話.txt": "一",
    "本文/第2話.txt": "二",
    "本文/第3話.txt": "三",
    "本文/第4話.txt": "四",
  };

  test("章の始まりの話から次の章の手前までを束ね、最初の章より前の話は先に。開始の話が無い章は最後", async () => {
    const chapters = {
      schemaVersion: "1",
      chapters: [
        { name: "第二章　港", startEpisodePath: "本文/第3話.txt" },
        { name: "第一章　灯", startEpisodePath: "本文/第2話.txt" },
        { name: "消えた章", startEpisodePath: "本文/第9話.txt" },
      ],
    };
    const store = put(new MemoryFileStore(), work(WORK, { ...files, "設定/章立て.json": JSON.stringify(chapters) }));
    const rows = episodeListRows(await scanWorkFolder(store, WORK));
    expect(rows.map((row) => (row.type === "chapter" ? `[${row.name}${row.missingStart ? "?" : ""}]` : row.no))).toEqual([
      "第1話",
      "[第一章　灯]",
      "第2話",
      "[第二章　港]",
      "第3話",
      "第4話",
      "[消えた章?]",
    ]);
  });

  test("章立てが読めなければ止めずに章なしで並べ、理由を残す", async () => {
    const store = put(new MemoryFileStore(), work(WORK, { ...files, "設定/章立て.json": "{壊れた" }));
    const scanned = await scanWorkFolder(store, WORK);
    expect(scanned.chapterError).toBeTruthy();
    expect(episodeListRows(scanned).every((row) => row.type === "episode")).toBe(true);
  });

  test("設定フォルダーの名前を変えた作品は、その場所の章立てを読み、その中の .md は話にしない", async () => {
    const store = put(
      new MemoryFileStore(),
      work(
        WORK,
        {
          ...files,
          "資料/人物.md": "# 人物",
          "資料/章立て.json": JSON.stringify({ chapters: [{ name: "第一章", startEpisodePath: "本文/第1話.txt" }] }),
        },
        { workTitle: "灯台守の手紙", settingsDir: "資料" }
      )
    );
    const scanned = await scanWorkFolder(store, WORK);
    expect(scanned.episodes).toHaveLength(4);
    expect(episodeListRows(scanned)[0]).toEqual({ type: "chapter", name: "第一章", missingStart: false });
  });
});

describe("最後に書いた日", () => {
  test("git の最後の版の日を読む。git でない作品は分からない", async () => {
    const backend = new MemoryGitFsBackend();
    const fs = createGitFs(backend);
    const dir = `/${WORK}`;
    await fs.promises.mkdir(dir);
    await git.init({ fs, dir, defaultBranch: "main" });
    await fs.promises.mkdir(`${dir}/本文`);
    await fs.promises.writeFile(`${dir}/本文/第1話.txt`, "猫");
    await git.add({ fs, dir, filepath: "本文/第1話.txt" });
    const at = Date.UTC(2026, 10, 15, 3, 0, 0);
    await git.commit({ fs, dir, message: "第1話", author: { name: "作者", email: "a@example.invalid", timestamp: at / 1000, timezoneOffset: 0 } });
    expect(await lastCommitTime(dir, backend)).toBe(at);

    await fs.promises.mkdir("/ほか_確認用");
    expect(await lastCommitTime("/ほか_確認用", backend)).toBeUndefined();

    const store = new GitFsFileStore(backend);
    const [item] = await listWorks(store, { lastWrittenOf: (root) => lastCommitTime(`/${root}`, backend) });
    expect(item.ok && item.work.lastWrittenAt).toBe(at);
    expect(workCard(item, new Date(at)).meta).toEqual(["1話", "1字", "最後に書いた日：今日"]);
  });

  test("日の言い方", () => {
    const now = new Date(2026, 10, 16, 9, 0);
    expect(dayLabel(new Date(2026, 10, 16, 0, 1), now)).toBe("今日");
    expect(dayLabel(new Date(2026, 10, 15, 23, 59), now)).toBe("昨日");
    expect(dayLabel(new Date(2026, 9, 21, 12, 0), now)).toBe("10月21日");
    expect(dayLabel(new Date(2025, 9, 21, 12, 0), now)).toBe("2025年10月21日");
  });
});
