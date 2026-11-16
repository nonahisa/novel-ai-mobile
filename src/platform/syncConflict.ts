import "./bufferShim";
import git from "isomorphic-git";
import { sideFileName } from "novel-ai-assistant/src/core/conflictFile";
import { decodeBytes, type TextFileContent } from "novel-ai-assistant/src/core/textDecode";
import { FileExistsError, dirname, joinStorePath, normalizeStorePath, type FileStore } from "./fileStore";
import type { createGitFs } from "./gitFs";
import { gitHttp } from "./gitHttp";
import { deleteTextFileWithRecovery, encodeForNewFile, writeTextFilePreservingFormat, type WriteTextFailureReason } from "./textFile";
import { collectChanges } from "./workPush";

/**
 * 同期の食い違いの扱い（設計書 6章「競合したら、両方とも残す」。決まりは共通設計書 2.8・本体の設計書 5.5.4）。
 *
 * 向こうの新しい版を取ってきたあと（`fetchRemoteHead`）、話ごとに3つを比べる。
 *
 * - **祖先**＝手元の HEAD（最後に向こうとそろえた版）
 * - **こちら**＝作業の木（書きかけを含む。記録していない変更も「こちらの変更」）
 * - **あちら**＝取ってきた向こうの版（`refs/remotes/origin/<枝>`）
 *
 * 浅い取得（`depth: 1`）なので歴史はたどらない。祖先は HEAD と決めて、木どうしを比べる
 * （isomorphic-git の `merge` は合流の元を歴史から探すので、途中の版が無いと止まる。`test/syncConflict.test.ts`）。
 *
 * ## 守ること
 *
 * - **競合が残っているあいだは、HEAD も作業の木も動かさない。** HEAD を先に進めると、選んでいない話の
 *   こちらの文が「ふつうの手元の変更」になり、送ると向こうの文を黙って潰す。HEAD が祖先のままなら、
 *   `pushWork` は `behind` を返し続ける
 * - **書きかけの話を黙って上書きしない。** isomorphic-git の「変わったか」は大きさと時刻で見るので見落とす
 *   （`git.test.ts` の【限界】）。あちらが変えた話は、こちらの中身を読んで名前（`oid`）を数えて比べ、
 *   書く直前にもう一度読む
 * - **開いている話は、取り込む前に保存を済ませる**（2026-11-16 作者の答え A「保存してから取り込む」）。
 *   `integrateIncoming` の `openStories` に自動保存の係（`src/app/autoSave.ts`）を渡すと、先に `flush()` し、
 *   1つでも「保存済み」にならなければ何も動かさずに止める。取り込みで書き換えた開いている話は `reopen` に返すので、
 *   呼ぶ側は読み直して自動保存の係を作り直す（古いハッシュのままだと次の保存が「外で変わりました」になる）
 * - **選ぶまで、競合した話には AI を当てない**（呼ぶ側が `plan.undecided` を見る）
 * - 原稿をこちらから書き換えるのは［あちら］を選んだときだけで、`writeTextFilePreservingFormat`
 *   を通す（文字コード・改行を保つ。外で変わっていたら書かない）
 * - ［両方残す］は本体と同じ：原稿はこちらの文のまま、あちらの文を同じフォルダーの
 *   `{元の名前}.conflict-{YYYY-MM-DD-HHmm}{拡張子}`（本体の `sideFileName`）へ、新しく作るだけで残す。
 *   元と同じ文字コード・改行で書く（`encodeForNewFile`）。設定資料の JSON には出さない（本体と同じ）
 *
 * 選んだ結果（［こちら］［両方残す］）は、端末の中だけの控え（`.git/novelai-conflict-choices.json`。
 * 送らない）に、あちらの版とこちらの中身の名前と一緒に残す。どちらかが変われば控えは効かなくなり、
 * もう一度選んでもらう。全部選び終えたら `integrateIncoming` が取り込む。
 */

type GitFs = ReturnType<typeof createGitFs>;

/** 話ごとの分け方 */
export type IncomingKind =
  /** こちらだけ変えた（取り込んでも、こちらの文はそのまま残る） */
  | "ours_only"
  /** あちらだけ変えた（取り込むと、作業の木をあちらの文にする） */
  | "theirs_only"
  /** 両方とも同じに変えた */
  | "same"
  /** 両方とも違うように変えた（片方が消した場合も） */
  | "conflict";

/** 作者が選ぶもの。［こちら］［あちら］［両方残す］ */
export type ConflictChoice = "ours" | "theirs" | "both";

export interface IncomingEntry {
  /** 作品フォルダーからの道（`/` 区切り） */
  path: string;
  kind: IncomingKind;
  /** 祖先の中身の名前（無ければ null） */
  base: string | null;
  /** 作業の木の中身の名前（消えていれば null） */
  ours: string | null;
  /** あちらの中身の名前（消していれば null） */
  theirs: string | null;
  /**
   * 競合で、もう選んだもの（［こちら］か［両方残す］。［あちら］はふつう選ぶと「同じ」になる。
   * こちらと文字コード・改行が違い、こちらの形で書いたときだけ `theirs` を控える）
   */
  decision?: "ours" | "both" | "theirs";
}

export interface IncomingPlan {
  /** 祖先（手元の HEAD） */
  base: string;
  /** あちらの版 */
  theirs: string;
  /** 変わった話（どれも変わっていなければ空） */
  entries: IncomingEntry[];
  /** 競合した話 */
  conflicts: IncomingEntry[];
  /** 競合のうち、まだ選んでいない話（ここにある話には AI を当てない） */
  undecided: IncomingEntry[];
}

export interface IncomingInput {
  fs: GitFs;
  /** git の作業の木（`/` で始まる） */
  dir: string;
  /** あちらの版。省けば `refs/remotes/origin/<今の枝>` */
  theirs?: string;
  /** アプリが書いた道（`collectChanges` と同じ。isomorphic-git が見落としても拾う） */
  touched?: readonly string[];
}

const CHOICES_FILE = "novelai-conflict-choices.json";

interface ChoiceRecord {
  theirs: string;
  entries: Record<string, { choice: "ours" | "both" | "theirs"; ours: string | null }>;
}

/** 版の木を「道 → 中身の名前」に開く */
async function flattenCommit(fs: GitFs, dir: string, commit: string): Promise<Map<string, string>> {
  const { commit: body } = await git.readCommit({ fs, dir, oid: commit });
  const out = new Map<string, string>();
  const walk = async (tree: string, prefix: string): Promise<void> => {
    const { tree: entries } = await git.readTree({ fs, dir, oid: tree });
    for (const entry of entries) {
      const path = prefix + entry.path;
      if (entry.type === "tree") await walk(entry.oid, `${path}/`);
      else if (entry.type === "blob") out.set(path, entry.oid);
    }
  };
  await walk(body.tree, "");
  return out;
}

/** 作業の木の中身の名前（無ければ null）。**必ず中身を読んで数える**（大きさと時刻では見ない） */
async function worktreeOid(fs: GitFs, dir: string, path: string): Promise<string | null> {
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array((await fs.promises.readFile(`${dir}/${path}`)) as Uint8Array);
  } catch {
    return null;
  }
  return (await git.hashBlob({ object: bytes })).oid;
}

async function readChoices(fs: GitFs, dir: string): Promise<ChoiceRecord | undefined> {
  try {
    const text = (await fs.promises.readFile(`${dir}/.git/${CHOICES_FILE}`, "utf8")) as string;
    const parsed = JSON.parse(text) as ChoiceRecord;
    return typeof parsed.theirs === "string" && parsed.entries ? parsed : undefined;
  } catch {
    return undefined;
  }
}

async function writeChoices(fs: GitFs, dir: string, record: ChoiceRecord): Promise<void> {
  await fs.promises.writeFile(`${dir}/.git/${CHOICES_FILE}`, JSON.stringify(record));
}

async function clearChoices(fs: GitFs, dir: string): Promise<void> {
  try {
    await fs.promises.unlink(`${dir}/.git/${CHOICES_FILE}`);
  } catch {
    // 無ければよい
  }
}

async function resolveTheirs(input: IncomingInput): Promise<string> {
  if (input.theirs) return input.theirs;
  const branch = (await git.currentBranch({ fs: input.fs, dir: input.dir })) ?? "main";
  return git.resolveRef({ fs: input.fs, dir: input.dir, ref: `refs/remotes/origin/${branch}` });
}

/**
 * 話ごとに「こちらだけ／あちらだけ／同じ／競合」に分ける。ファイルには何も書かない。
 */
export async function planIncoming(input: IncomingInput): Promise<IncomingPlan> {
  const { fs, dir } = input;
  const base = await git.resolveRef({ fs, dir, ref: "HEAD" });
  const theirs = await resolveTheirs(input);
  if (theirs === base) return { base, theirs, entries: [], conflicts: [], undecided: [] };

  const baseFiles = await flattenCommit(fs, dir, base);
  const theirsFiles = await flattenCommit(fs, dir, theirs);
  const theirsChanged = new Set<string>();
  for (const path of new Set([...baseFiles.keys(), ...theirsFiles.keys()])) {
    if (baseFiles.get(path) !== theirsFiles.get(path)) theirsChanged.add(path);
  }

  const record = await readChoices(fs, dir);
  const entries: IncomingEntry[] = [];
  for (const path of [...theirsChanged].sort()) {
    const b = baseFiles.get(path) ?? null;
    const t = theirsFiles.get(path) ?? null;
    const o = await worktreeOid(fs, dir, path);
    const kind: IncomingKind = o === b ? "theirs_only" : o === t ? "same" : "conflict";
    const entry: IncomingEntry = { path, kind, base: b, ours: o, theirs: t };
    const chosen = record?.theirs === theirs ? record.entries[path] : undefined;
    if (kind === "conflict" && chosen && chosen.ours === o) entry.decision = chosen.choice;
    entries.push(entry);
  }
  // あちらが変えていない話の、こちらの変更（取り込んでもそのまま残る）
  for (const change of await collectChanges(fs, dir, input.touched ?? [])) {
    if (theirsChanged.has(change.path)) continue;
    entries.push({
      path: change.path,
      kind: "ours_only",
      base: baseFiles.get(change.path) ?? null,
      ours: "deleted" in change ? null : (change.oid ?? null),
      theirs: baseFiles.get(change.path) ?? null,
    });
  }
  entries.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
  const conflicts = entries.filter((entry) => entry.kind === "conflict");
  return { base, theirs, entries, conflicts, undecided: conflicts.filter((entry) => !entry.decision) };
}

/** 置き場（`FileStore`）の側で、作品フォルダーがどこにあるか */
/**
 * 開いている話（自動保存の係が持っている話）。`AutoSave` がそのまま当てはまる形
 * （`path` は置き場の根からの道、`flush()` は保存を済ませてそのときの状態を返す）
 */
export interface OpenStory {
  readonly path: string;
  flush(): Promise<string>;
}

/** 自動保存の「保存済み」（`src/app/autoSave.ts` の `AutoSaveStatus` と同じ字） */
const SAVED = "保存済み";

export interface StoreSide {
  store: FileStore;
  /** 置き場の根からの作品フォルダーの道（git の `dir` と同じ所を指す。例 `作品`） */
  storeDir: string;
  /** 開いている話。取り込む前に保存を済ませる（2026-11-16 作者の答え A） */
  openStories?: readonly OpenStory[];
}

export type IntegrateResult =
  | { kind: "up_to_date" }
  /** 選んでいない競合がある。何も動かしていない */
  | { kind: "conflicts"; plan: IncomingPlan }
  /** 開いている話の保存が済まなかった（外で変わった・書けない字など）。何も動かしていない */
  | { kind: "open_unsaved"; path: string; status: string }
  /** 書く直前に読み直したら、こちらで書き換わっていた。HEAD は動かしていない（もう一度 `planIncoming` から） */
  | { kind: "changed_meanwhile"; path: string }
  | {
      kind: "integrated";
      head: string;
      /** こちらの変更が無く、作業の木があちらの版そのものになった（早送り） */
      fastForward: boolean;
      /** あちらの文にした話 */
      taken: string[];
      /** こちらの文を残した話（こちらだけ変えた話・［こちら］［両方残す］を選んだ話）。送るとあちらへ届く */
      kept: string[];
      /** 取り込みで書き換えた、開いている話（置き場の道）。読み直して自動保存の係を作り直す */
      reopen: string[];
    };

/**
 * 取り込む（早送り、またはこちらの変更を残したまま、あちらだけが変えた話を取り込む）。
 *
 * 選んでいない競合があれば、何もせずに `conflicts` を返す。取り込めたら HEAD をあちらの版にし、
 * 索引をそろえる（`pushWork` は索引から木を数えるため）。
 */
export async function integrateIncoming(input: IncomingInput & StoreSide): Promise<IntegrateResult> {
  const { fs, dir, store, storeDir } = input;
  // 開いている話の書きかけを先に保存する（その字は「こちらの変更」として比べられる）
  for (const story of input.openStories ?? []) {
    const status = await story.flush();
    if (status !== SAVED) return { kind: "open_unsaved", path: story.path, status };
  }
  const plan = await planIncoming(input);
  if (plan.theirs === plan.base) return { kind: "up_to_date" };
  if (plan.undecided.length > 0) return { kind: "conflicts", plan };

  const taken: string[] = [];
  for (const entry of plan.entries) {
    if (entry.kind !== "theirs_only") continue;
    // 書く直前にもう一度読む（分けたあとに打った字を潰さない）
    if ((await worktreeOid(fs, dir, entry.path)) !== entry.base) return { kind: "changed_meanwhile", path: entry.path };
    const storePath = joinStorePath(storeDir, entry.path);
    if (entry.theirs === null) {
      await store.deleteFile(storePath);
    } else {
      // あちらの中身をそのまま書く（取り込んだ版の木と作業の木を同じにするため。形を変えると「変わった話」になる）
      const { blob } = await git.readBlob({ fs, dir, oid: entry.theirs });
      if (entry.base === null) {
        await store.createDirectory(dirname(storePath));
        await store.writeFile(storePath, blob, { mode: "create" });
      } else {
        await store.writeFile(storePath, blob, { mode: "overwrite" });
      }
    }
    taken.push(entry.path);
  }

  const branch = (await git.currentBranch({ fs, dir })) ?? "main";
  await git.writeRef({ fs, dir, ref: `refs/heads/${branch}`, value: plan.theirs, force: true });
  await git.writeRef({ fs, dir, ref: `refs/remotes/origin/${branch}`, value: plan.theirs, force: true });
  // 索引を新しい HEAD にそろえる（こちらの文を残した話は、作業の木だけが違う＝送っていない話になる）
  for (const entry of plan.entries) await git.resetIndex({ fs, dir, filepath: entry.path });
  await clearChoices(fs, dir);

  const kept = plan.entries.filter((entry) => entry.kind === "ours_only" || entry.kind === "conflict").map((entry) => entry.path);
  const open = new Set((input.openStories ?? []).map((story) => normalizeStorePath(story.path)));
  const reopen = taken.map((path) => joinStorePath(storeDir, path)).filter((path) => open.has(path));
  return { kind: "integrated", head: plan.theirs, fastForward: kept.length === 0, taken, kept, reopen };
}

/** 競合した話の片側 */
export interface ConflictSide {
  /** 在るか（消していれば false） */
  exists: boolean;
  /** 本文（改行は LF にそろえたもの）。無ければ空 */
  text: string;
  /** 中身の名前 */
  oid: string | null;
}

/** 選ぶための材料（両方の中身） */
export interface ConflictMaterial {
  path: string;
  /** あちらの版（選ぶときに、この版のままかを確かめる） */
  theirsCommit: string;
  ours: ConflictSide & {
    /** こちらの原稿の形（文字コード・改行）とハッシュ。無ければ undefined */
    content?: TextFileContent;
  };
  theirs: ConflictSide;
  base: ConflictSide;
  /** 出してよい選択肢。［両方残す］は両方に原稿があり、JSON でないときだけ（本体と同じ） */
  choices: ConflictChoice[];
}

/** 競合した話の、選ぶための材料を読む。競合でなければ undefined */
export async function readConflict(
  input: IncomingInput & StoreSide & { path: string }
): Promise<ConflictMaterial | undefined> {
  const { fs, dir, store, storeDir, path } = input;
  const plan = await planIncoming(input);
  const entry = plan.conflicts.find((candidate) => candidate.path === path);
  if (!entry) return undefined;

  const fromBlob = async (oid: string | null): Promise<ConflictSide> => {
    if (oid === null) return { exists: false, text: "", oid: null };
    const { blob } = await git.readBlob({ fs, dir, oid });
    return { exists: true, text: decodeBytes(blob).text, oid };
  };
  let content: TextFileContent | undefined;
  try {
    content = decodeBytes(await store.readFile(joinStorePath(storeDir, path)));
  } catch {
    content = undefined;
  }
  const ours = content
    ? { exists: true, text: content.text, oid: entry.ours, content }
    : { exists: false, text: "", oid: null };
  const theirs = await fromBlob(entry.theirs);
  const choices: ConflictChoice[] = ["ours", "theirs"];
  if (ours.exists && theirs.exists && !path.toLowerCase().endsWith(".json")) choices.push("both");
  return { path, theirsCommit: plan.theirs, ours, theirs, base: await fromBlob(entry.base), choices };
}

export type ApplyChoiceResult =
  | {
      ok: true;
      choice: ConflictChoice;
      /** ［両方残す］で作った別ファイル（作品フォルダーからの道） */
      sidePath?: string;
      /** ［あちら］で原稿を消したとき、消す前の中身を写した退避（置き場の道） */
      recoveryPath?: string;
      /**
       * ［あちら］で、原稿があちらの中身とバイトまで同じになったか。こちらと文字コード・改行が違うと
       * false（こちらの形で書いたので、取り込んだあと「送っていない話」になる）
       */
      exact?: boolean;
    }
  | {
      ok: false;
      reason:
        | WriteTextFailureReason
        /** 選べない選択肢（JSON の［両方残す］など） */
        | "not_offered"
        /** 材料を読んだあとに、あちらの版が進んだか、もう競合でない */
        | "stale";
      detail?: string;
    };

/**
 * ［こちら］［あちら］［両方残す］を当てる。`material` は `readConflict` が返したもの
 * （作者が見た中身。読んだあとにこちらで書き換わっていたら書かない）。
 *
 * - ［こちら］原稿は何も変えない。選んだことを控える
 * - ［あちら］原稿をあちらの文にする（`writeTextFilePreservingFormat`）。こちらが消していた話は
 *   あちらの中身で新しく作り、あちらが消した話は消す
 * - ［両方残す］原稿はこちらの文のまま、あちらの文を別ファイルへ新しく作る。作れなければ何も変えない
 *
 * 全部の競合を選んだら、`integrateIncoming` で取り込む。
 */
export async function applyConflictChoice(
  input: IncomingInput &
    StoreSide & {
      material: ConflictMaterial;
      choice: ConflictChoice;
      /** 別ファイルの名前に入れる時刻（試験で替える） */
      now?: Date;
    }
): Promise<ApplyChoiceResult> {
  const { fs, dir, store, storeDir, material, choice } = input;
  if (!material.choices.includes(choice)) return { ok: false, reason: "not_offered" };
  const plan = await planIncoming(input);
  if (plan.theirs !== material.theirsCommit) return { ok: false, reason: "stale" };
  const entry = plan.conflicts.find((candidate) => candidate.path === material.path);
  if (!entry || entry.theirs !== material.theirs.oid) return { ok: false, reason: "stale" };
  // 作者が見たこちらの中身のままか
  if (entry.ours !== material.ours.oid) return { ok: false, reason: "modified_externally" };
  const storePath = joinStorePath(storeDir, material.path);

  if (choice === "theirs") {
    const original = material.ours.content;
    if (!material.theirs.exists) {
      // あちらは消した。こちらの中身が見たときのままなら、退避へ写してから消す（こちらの送っていない直しは
      // git に記録していないので、退避が無いと戻らない。写せなければ消さない。引継ぎ書 62章）
      if (!original) return { ok: true, choice, exact: true };
      const deleted = await deleteTextFileWithRecovery(store, storePath, original.hash);
      if (!deleted.ok) return { ok: false, reason: deleted.reason, ...(deleted.detail ? { detail: deleted.detail } : {}) };
      return { ok: true, choice, exact: true, recoveryPath: deleted.recoveryPath };
    }
    if (!original) {
      // こちらは消していた。あちらの中身をそのまま新しく作る（本文を書き戻す口は、在るファイルにしか書かない）
      const { blob } = await git.readBlob({ fs, dir, oid: material.theirs.oid! });
      try {
        await store.createDirectory(dirname(storePath));
        await store.writeFile(storePath, blob, { mode: "create" });
      } catch (error) {
        return { ok: false, reason: error instanceof FileExistsError ? "modified_externally" : "path_conflict", detail: describe(error) };
      }
      return { ok: true, choice, exact: true };
    }
    const written = await writeTextFilePreservingFormat(store, storePath, material.theirs.text, original, original.hash);
    if (!written.ok) return { ok: false, reason: written.reason, ...(written.detail ? { detail: written.detail } : {}) };
    const now = await worktreeOid(fs, dir, material.path);
    if (now === material.theirs.oid) return { ok: true, choice, exact: true };
    // こちらの形（文字コード・改行）で書いたので、中身の名前はあちらと違う＝まだ「競合」に見える。
    // 選んだことを、書いたあとの中身の名前と一緒に控える（取り込むと、送っていない話として残る）
    await recordChoice(fs, dir, material, "theirs", now);
    return { ok: true, choice, exact: false };
  }

  let sidePath: string | undefined;
  if (choice === "both") {
    // 捨てる側を先に別ファイルへ逃がしてから確定する（本体と同じ。逆だと、書き出しに失敗したとき版が失われる）
    const original = material.ours.content!;
    const bytes = encodeForNewFile(material.theirs.text, original);
    if (!bytes) {
      return { ok: false, reason: "encoding_error", detail: `あちらの文に、元の文字コード（${original.encoding}）で書けない字があります` };
    }
    const folder = dirname(storePath);
    let existing = new Set<string>();
    try {
      existing = new Set(await store.listFiles(folder));
    } catch {
      // 読めなくても止めない。作るのは「無いときだけ」なので、在るファイルは潰さない
    }
    const fileName = material.path.slice(material.path.lastIndexOf("/") + 1);
    const name = sideFileName(fileName, input.now ?? new Date(), existing);
    try {
      await store.writeFile(joinStorePath(folder, name), bytes, { mode: "create" });
    } catch (error) {
      return { ok: false, reason: "path_conflict", detail: describe(error) };
    }
    const slash = material.path.lastIndexOf("/");
    sidePath = `${slash >= 0 ? material.path.slice(0, slash + 1) : ""}${name}`;
  }

  await recordChoice(fs, dir, material, choice, entry.ours);
  return { ok: true, choice, ...(sidePath ? { sidePath } : {}) };
}

async function recordChoice(fs: GitFs, dir: string, material: ConflictMaterial, choice: "ours" | "both" | "theirs", ours: string | null): Promise<void> {
  const record = (await readChoices(fs, dir)) ?? { theirs: material.theirsCommit, entries: {} };
  const next: ChoiceRecord = record.theirs === material.theirsCommit ? record : { theirs: material.theirsCommit, entries: {} };
  next.entries[material.path] = { choice, ours };
  await writeChoices(fs, dir, next);
}

/**
 * 向こうの枝の新しい版を取ってくる（浅く、文字の本文だけ）。作業の木も HEAD も動かさない。
 * 取ってきた版の名前を返す（`refs/remotes/origin/<枝>` に入る）。通信するので試験では呼ばない。
 */
export async function fetchRemoteHead(input: {
  fs: GitFs;
  dir: string;
  owner: string;
  repo: string;
  branch: string;
  token?: string;
}): Promise<string> {
  await git.fetch({
    fs: input.fs,
    http: await gitHttp(),
    dir: input.dir,
    url: `https://github.com/${input.owner}/${input.repo}.git`,
    ref: input.branch,
    singleBranch: true,
    depth: 1,
    ...(input.token ? { onAuth: () => ({ username: "x-access-token", password: input.token }) } : {}),
  });
  return git.resolveRef({ fs: input.fs, dir: input.dir, ref: `refs/remotes/origin/${input.branch}` });
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
