import type { FileStore } from "../platform/fileStore";
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
 *
 * 道の id は、読んだ資料の中から探すだけに使う（置き場の道にはしない）。直す・関係を見るは、まだ無い
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
      ? `<div class="menu-items"><a class="menu-item built" id="materialEnrich" href="${escapeHtml(materialEnrichHash(root, item.kind, item.id))}">本文から読み直す</a></div>`
      : "";
  return `<article class="materials-detail"><h2>${escapeHtml(item.name)}</h2>${flags(item) ? `<p class="materials-flags">${flags(item)}</p>` : ""}<dl>${lines}</dl>${enrich}</article>`;
}

export interface MaterialsRoute {
  root?: string;
  kind?: string;
  id?: string;
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
    const item = findMaterial(materials, route.kind, route.id);
    done(item ? renderMaterialDetail(item, route.root) : `<p class="materials-missing">${MATERIAL_MISSING}</p>`);
  })();
}
