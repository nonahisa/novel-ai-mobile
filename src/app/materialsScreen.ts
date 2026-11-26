import type { FileStore } from "../platform/fileStore";
import { readMaterialRelations, type MaterialRelations } from "../platform/materialRelations";
import { findMaterial, readWorkMaterials, type MaterialItem, type WorkMaterials } from "../platform/workMaterials";
import { findWorkRoots, readWorkLayout } from "../platform/workScan";
import { escapeHtml, renderAppBar } from "./menuScreen";

/**
 * **設定資料（E）を見る**（設計書 4章の画面 E。2026-11-21。読むだけ）。
 *
 * - `#/materials`：作品を選ぶ
 * - `#/materials/<作品>`：種類ごとの一覧（名前・短い紹介・「作者」「モブ」の印）と、読めなかったファイル
 * - `#/materials/<作品>/<種類>/<id>`：1件。値の入った欄だけ（`platform/workMaterials.ts`）
 *
 * - `#/materials/<作品>/<種類>/<id>/enrich`：1件を本文から読み直す（`materialEnrichScreen.ts`。2026-11-22）
 * - `#/materials/<作品>/character/<id>/relations`：その人物の関係を見る（`platform/materialRelations.ts`。読むだけ。2026-11-22）
 * - `#/materials/<作品>/<種類>/<id>/edit`：1件を手で直す（`materialEditScreen.ts`。2026-11-27 作者の答え「全部の欄」。伏線は除く）
 *
 * 道の id は、読んだ資料の中から探すだけに使う（置き場の道にはしない）
 */

export function materialsHash(root?: string, kind?: string, id?: string): string {
  if (root === undefined) return "#/materials";
  const base = `#/materials/${encodeURIComponent(root)}`;
  return kind !== undefined && id !== undefined ? `${base}/${encodeURIComponent(kind)}/${encodeURIComponent(id)}` : base;
}

/** 1件を本文から読み直す画面（`materialEnrichScreen.ts`） */
export function materialEnrichHash(root: string, kind: string, id: string): string {
  return `${materialsHash(root, kind, id)}/enrich`;
}

/** 1件を手で直す画面（`materialEditScreen.ts`） */
export function materialEditHash(root: string, kind: string, id: string): string {
  return `${materialsHash(root, kind, id)}/edit`;
}

/** その人物の関係を見る画面 */
export function materialRelationsHash(root: string, id: string): string {
  return `${materialsHash(root, "character", id)}/relations`;
}

/** 本文から読み直せる種類（本体の［AIで再読込］と同じ。伏線は無い） */
const ENRICHABLE = new Set(["character", "ability", "organization", "location", "world"]);

export const MATERIALS_EMPTY = "この作品には、まだ設定資料がありません";
export const MATERIAL_MISSING = "この資料は見つかりませんでした";

function flags(item: MaterialItem): string {
  return `${item.byAuthor ? `<span class="flag">作者</span>` : ""}${item.isMob ? `<span class="flag">モブ</span>` : ""}`;
}

export function renderMaterialsList(root: string, materials: WorkMaterials): string {
  const groups = materials.groups
    .map(
      (group) =>
        `<section class="materials-kind"><h2>${escapeHtml(group.label)}</h2>` +
        group.items
          .map(
            (item) =>
              `<a class="materials-row" href="${escapeHtml(materialsHash(root, item.kind, item.id))}"><span class="materials-name">${escapeHtml(item.name)}${flags(item)}</span>` +
              `${item.summary ? `<span class="materials-summary">${escapeHtml(item.summary)}</span>` : ""}</a>`
          )
          .join("") +
        `</section>`
    )
    .join("");
  const errors =
    materials.errors.length > 0
      ? `<section class="materials-errors"><h2>読めなかった資料</h2><ul>${materials.errors
          .map((error) => `<li><code>${escapeHtml(error.file)}</code><span>${escapeHtml(error.message)}</span></li>`)
          .join("")}</ul></section>`
      : "";
  const empty = materials.groups.length === 0 ? `<p class="materials-empty">${MATERIALS_EMPTY}</p>` : "";
  return `${empty}${groups}${errors}`;
}

export function renderMaterialDetail(item: MaterialItem, root?: string): string {
  const lines = item.lines
    .map((line) => `<dt>${escapeHtml(line.label)}${line.byAuthor ? `<span class="flag">作者</span>` : ""}</dt><dd>${escapeHtml(line.value)}</dd>`)
    .join("");
  const enrich =
    root !== undefined && ENRICHABLE.has(item.kind)
      ? `<a class="menu-item built" id="materialEnrich" href="${escapeHtml(materialEnrichHash(root, item.kind, item.id))}">本文から読み直す</a>`
      : "";
  // 関係を見るは人物だけ（本体の相関図も人物だけ）
  const relations =
    root !== undefined && item.kind === "character"
      ? `<a class="menu-item built" id="materialRelations" href="${escapeHtml(materialRelationsHash(root, item.id))}">関係を見る</a>`
      : "";
  // 手で直すのは、本体の設定資料パネルで直せる5種類（伏線は本体でも別の画面）
  const edit =
    root !== undefined && ENRICHABLE.has(item.kind)
      ? `<a class="menu-item built" id="materialEdit" href="${escapeHtml(materialEditHash(root, item.kind, item.id))}">直す</a>`
      : "";
  const actions = edit || enrich || relations ? `<div class="menu-items">${edit}${enrich}${relations}</div>` : "";
  return `<article class="materials-detail"><h2>${escapeHtml(item.name)}</h2>${flags(item) ? `<p class="materials-flags">${flags(item)}</p>` : ""}<dl>${lines}</dl>${actions}</article>`;
}

export const RELATIONS_EMPTY = "つながっている人は、まだ資料にありません";

/** その人物とじかにつながる人の一覧（相手の名前はその人の1件へ。資料に無い相手は押せない） */
export function renderMaterialRelations(root: string, relations: MaterialRelations): string {
  if (relations.rows.length === 0) return `<p class="materials-empty">${RELATIONS_EMPTY}</p>`;
  const rows = relations.rows
    .map((row) => {
      const name = row.provisional
        ? `<span class="materials-name">${escapeHtml(row.name)}<span class="flag">${escapeHtml(row.missing ?? "")}</span></span>`
        : `<a class="materials-name" href="${escapeHtml(materialsHash(root, "character", row.id))}">${escapeHtml(row.name)}</a>`;
      const line = (who: string, words: string[]) => (words.length > 0 ? `<p class="relation-words">${escapeHtml(`${who}から：${words.join("・")}`)}</p>` : "");
      return `<li class="relation-row">${name}${line(relations.name, row.fromCenter)}${line(row.name, row.toCenter)}</li>`;
    })
    .join("");
  return `<p class="enrich-note">関係と呼び方は、それぞれの人物の資料に片側ずつ書かれています（読むだけ）</p><ul class="relation-rows">${rows}</ul>`;
}

export interface MaterialsRoute {
  root?: string;
  kind?: string;
  id?: string;
  relations?: true;
}

/** 画面を組む。題は作品を読んでから差し替える */
export function mountMaterialsScreen(screen: HTMLElement, store: FileStore, route: MaterialsRoute, stillHere: () => boolean): void {
  screen.innerHTML = `${renderAppBar("設定資料", { back: true })}<div class="materials" id="materialsSlot" aria-busy="true"></div>`;
  const slot = screen.querySelector<HTMLElement>("#materialsSlot")!;
  const done = (html: string) => {
    if (!stillHere()) return;
    slot.innerHTML = html;
    slot.removeAttribute("aria-busy");
  };
  const setTitle = (title: string) => {
    const el = screen.querySelector<HTMLElement>(".appbar-title");
    if (el) el.textContent = title;
  };
  void (async () => {
    if (route.root === undefined) {
      const roots = await findWorkRoots(store).catch((): string[] => []);
      const rows = await Promise.all(
        roots.map(async (root) => ({ root, title: await readWorkLayout(store, root).then((layout) => layout.title, () => root) }))
      );
      done(
        rows.length === 0
          ? `<p class="materials-empty">作品がありません</p>`
          : `<div class="materials-works">${rows
              .map((row) => `<a class="materials-work" href="${escapeHtml(materialsHash(row.root))}">${escapeHtml(row.title)}</a>`)
              .join("")}</div>`
      );
      return;
    }
    let materials: WorkMaterials;
    try {
      const layout = await readWorkLayout(store, route.root);
      if (stillHere()) setTitle(`設定資料：${layout.title}`);
      materials = await readWorkMaterials(store, layout.settings);
    } catch (error) {
      done(`<p class="materials-empty">${escapeHtml(error instanceof Error ? error.message : String(error))}</p>`);
      return;
    }
    if (route.kind === undefined || route.id === undefined) return done(renderMaterialsList(route.root, materials));
    if (route.relations && route.kind === "character") {
      const relations = await readMaterialRelations(store, (await readWorkLayout(store, route.root)).settings, route.id).catch(() => undefined);
      if (relations && stillHere()) setTitle(`関係：${relations.name}`);
      return done(relations ? renderMaterialRelations(route.root, relations) : `<p class="materials-missing">${MATERIAL_MISSING}</p>`);
    }
    const item = findMaterial(materials, route.kind, route.id);
    done(item ? renderMaterialDetail(item, route.root) : `<p class="materials-missing">${MATERIAL_MISSING}</p>`);
  })();
}
