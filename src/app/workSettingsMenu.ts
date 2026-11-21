import {
  GENRE_SITES,
  MEMO_MARKER_DEFS,
  WORK_KINDS,
  formatGenres,
  listGenres,
  memoMarkerLabels,
  memoMarkersOf,
  sameMemoMarkers,
  selectableWorkFormats,
  suggestWorkFormat,
  workKindDef,
  type GenreChoice,
  type MemoMarkerId,
  type WorkKindKey,
} from "../shared";
import type { FileStore } from "../platform/fileStore";
import { readWorkMemoMarkers } from "../platform/memoMarkers";
import { readWorkLayout, scanWorkFolder } from "../platform/workScan";
import { findMarkedLines, readPlotSections, readWorkKindOf, writePlotBasics, writeWorkKind, writeWorkMemoMarkers } from "../platform/workSettings";
import { askChoice, chooseFrom, chooseMany, tell } from "./dialog";

/**
 * **作品の長押し → 作品の設定**（設計書 4.4.1。2026-11-21 作者の答え「形式・ジャンルも」：メモの印・作品の種類・形式・ジャンル）。
 * 本体の［作品管理 → 作品別設定］の同じ項目と同じ流れ・同じ言い方。**本文は1字も書き換えない**。
 * 書く部品は `platform/workSettings.ts`
 */
export interface WorkSettingsDeps {
  store: FileStore;
  toast: (text: string) => void;
}

export async function openWorkSettings(deps: WorkSettingsDeps, root: string): Promise<void> {
  const picked = await chooseFrom([
    { id: "memo", label: "メモの印" },
    { id: "kind", label: "作品の種類" },
    { id: "plot", label: "形式・ジャンル" },
  ]);
  if (picked === "memo") return chooseMemoMarkers(deps, root);
  if (picked === "kind") return chooseWorkKind(deps, root);
  if (picked === "plot") return chooseFormatAndGenres(deps, root);
}

/**
 * 形式・ジャンル（本体の `setPlotBasics`）。形式 → ジャンル（投稿先を先に選び、その体系から いくつでも。投稿先を替えて続けられる）→ プロットへ書く。
 * 形式は、いまプロットに書かれているものと、いまの分量の目安に印（決めつけない。「脚本」は種類で選ぶので並べない）。
 * ジャンルは決めないまま進める（書いてあるジャンルは消さない）。［やめる］は全部を取りやめる（何も書かない）
 */
export async function chooseFormatAndGenres(deps: WorkSettingsDeps, root: string): Promise<void> {
  let current;
  try {
    current = await readPlotSections(deps.store, root);
  } catch (error) {
    return tell(`形式・ジャンルを選べませんでした。${error instanceof Error ? error.message : String(error)}`);
  }
  const written = current.sections.format.trim();
  const work = await scanWorkFolder(deps.store, root).catch(() => undefined);
  const suggested = work ? suggestWorkFormat(work.stats.totals.net, work.episodes.length) : undefined;
  const formats = selectableWorkFormats();
  const formatId = await chooseFrom(
    formats.map((format) => ({
      id: format.key,
      label:
        written === format.label
          ? `${format.label}（いまプロットに書かれています）`
          : suggested?.key === format.key && work
            ? `${format.label}（いまの分量の目安：${work.episodes.length}話 / ${work.stats.totals.net.toLocaleString("ja-JP")}字）`
            : format.label,
    }))
  );
  const format = formats.find((candidate) => candidate.key === formatId);
  if (!format) return;

  const chosen: GenreChoice[] = [];
  for (;;) {
    const siteId = await chooseFrom(
      [
        ...GENRE_SITES.map((site) => ({ id: site.key, label: `${site.label}（${listGenres(site).length}件から選ぶ）` })),
        { id: "done", label: chosen.length > 0 ? `これで決める（${chosen.map((choice) => choice.genre).join("、")}）` : "ジャンルは決めない" },
      ],
      "すべてやめる"
    );
    if (!siteId) return;
    if (siteId === "done") break;
    const site = GENRE_SITES.find((candidate) => candidate.key === siteId)!;
    const genres = listGenres(site);
    const picked = await chooseMany(
      `${site.label}のジャンル（いくつでも）`,
      genres.map((choice, index) => ({
        id: String(index),
        // 大ジャンルを持つ体系では、どちらの「異世界」かが分からないと選べない
        label: choice.group ? `${choice.group} > ${choice.genre}` : choice.genre,
        checked: chosen.some((already) => already.site === choice.site && already.genre === choice.genre && already.group === choice.group),
      }))
    );
    if (!picked) continue;
    for (const index of picked) {
      const choice = genres[Number(index)]!;
      if (!chosen.some((already) => already.site === choice.site && already.genre === choice.genre && already.group === choice.group)) chosen.push(choice);
    }
  }

  const outcome = await writePlotBasics(deps.store, root, format.label, chosen.length > 0 ? formatGenres(chosen) : undefined);
  if (!outcome.ok) return tell(`形式・ジャンルをプロットへ書けませんでした。${outcome.message}`);
  deps.toast(
    chosen.length > 0 ? `形式を「${format.label}」、ジャンルを${chosen.length}件、プロットへ書きました` : `形式を「${format.label}」としてプロットへ書きました`
  );
}

async function titleOf(deps: WorkSettingsDeps, root: string): Promise<string> {
  return readWorkLayout(deps.store, root).then((layout) => layout.title).catch(() => root);
}

/** メモの印を選ぶ（本体の `setMemoMarkers`） */
export async function chooseMemoMarkers(deps: WorkSettingsDeps, root: string): Promise<void> {
  let current;
  try {
    current = await readWorkMemoMarkers(deps.store, root);
  } catch (error) {
    // 壊れた設定は直さずに止める（本体の決まり2）。理由はそのまま出す
    return tell(`メモの印を選べませんでした。${error instanceof Error ? error.message : String(error)}`);
  }
  const title = await titleOf(deps, root);
  const ids = await chooseMany(
    `「${title}」のメモの印。行の頭に書くと、その行がメモ（付箋）になる印を選びます（いくつでも。本文は書き換えません）`,
    MEMO_MARKER_DEFS.map((def) => ({ id: def.id, label: def.detail ? `${def.label}（${def.detail}）` : def.label, checked: current.ids.includes(def.id) }))
  );
  if (ids === undefined) return;
  if (ids.length === 0) return deps.toast("メモの印は1つ以上選んでください。印は変えていません");
  const next = memoMarkersOf(ids);
  if (sameMemoMarkers(current, next)) return;
  /*
    **新しくオンにする印があるときは、切り替える前に数える**（本体 設計書 6.40.8・作者の決定）。
    いまは本文として数えている行が、切り替えたとたんに字数・投稿用のコピー・書き出しから外れる。0件なら確かめずに切り替える
  */
  const added = memoMarkersOf(next.ids.filter((id) => !current.ids.includes(id)));
  if (added.ids.length > 0) {
    const found = await findMarkedLines(deps.store, root, added).catch(() => ({ places: [] as string[], unreadable: 1 }));
    if (found.places.length > 0 || found.unreadable > 0) {
      const shown = found.places.slice(0, 5).join("、");
      const rest = found.places.length > 5 ? ` ほか${found.places.length - 5}か所` : "";
      const unreadable = found.unreadable > 0 ? `（読めなかった話が${found.unreadable}話あり、そこは数えていません）` : "";
      const detail =
        found.places.length > 0
          ? `「${title}」の本文に、${memoMarkerLabels(added)} で始まる行が${found.places.length}か所あります（${shown}${rest}）${unreadable}。` +
            "これらの行は、字数・投稿用のコピー・書き出しから外れます（本文のファイルは書き換えません）。切り替えますか"
          : `「${title}」の本文に、${memoMarkerLabels(added)} で始まる行は見つかりませんでした${unreadable}。切り替えますか`;
      if (!(await askChoice(detail, "切り替える", "やめる"))) return;
    }
  }
  const outcome = await writeWorkMemoMarkers(deps.store, root, next.ids as MemoMarkerId[]);
  if (!outcome.ok) return tell(`メモの印を変えられませんでした。${outcome.message}`);
  deps.toast(`メモの印を「${memoMarkerLabels(next)}」にしました。本文は変えていません`);
}

/** 作品の種類を選ぶ（本体の `setWorkKind`） */
export async function chooseWorkKind(deps: WorkSettingsDeps, root: string): Promise<void> {
  const { kind: current } = await readWorkKindOf(deps.store, root);
  const picked = await chooseFrom(WORK_KINDS.map((kind) => ({ id: kind.key, label: kind.key === current ? `${kind.label}（いまの種類）` : kind.label })));
  if (!picked || picked === current) return;
  const kind = picked as WorkKindKey;
  const outcome = await writeWorkKind(deps.store, root, kind);
  if (!outcome.ok) return tell(`種類を変えられませんでした。${outcome.message}`);
  deps.toast(`種類を「${workKindDef(kind).label}」にしました。本文は変えていません。これから作る話の雛形・字数の目安・組み方が変わります`);
}
