import { buildRelationGraph, egoGraph, parseCharacter, type Character, type RelationEdge } from "../shared";
import type { FileStore } from "./fileStore";
import { readKind } from "./workTerms";

/**
 * **設定資料の1件 → 関係を見る**（設計書 4.4.1。2026-11-22）。本体の人物相関図（設計書6.38）の個人中心図と同じ材料：
 * `buildRelationGraph`（関係・呼び方を人物の名前・別名で引き当てる。資料に無い相手は落とさず仮の相手にする）→
 * `egoGraph`（その人とじかにつながる人だけ）。AI は使わない。**読むだけ**。
 *
 * 狭い画面なので図は描かず、つながっている人を並べる（本体の相関図の右の欄「つながっている人」と同じ中身）。
 * 言葉は向きごとに分ける——中心の人から相手への言葉と、相手から中心の人への言葉（関係は片側ずつ書かれるので、
 * 片方だけ直すと向かい側の誤りが残る。本体の「相手側の記録」と同じ理由）
 */

export interface RelationRow {
  /** 人物の id（資料に無い相手は本体の仮の id。画面の道には使わない） */
  id: string;
  name: string;
  /** 資料に無い相手（名前でも別名でも当たらない・同じ名前が複数） */
  provisional: boolean;
  missing?: string;
  /** 中心の人から相手への言葉（関係はそのまま、呼び方は『』。話数が分かれば「（第N話から）」） */
  fromCenter: string[];
  /** 相手から中心の人への言葉 */
  toCenter: string[];
}

export interface MaterialRelations {
  name: string;
  rows: RelationRow[];
}

function wordsOf(edge: RelationEdge, from: string): string[] {
  return edge.labels
    .filter((label) => label.from === from)
    .map((label) => `${label.kind === "address" ? `『${label.text}』` : label.text}${label.firstChapter !== null ? `（第${label.firstChapter}話から）` : ""}`);
}

/** その人物とじかにつながる人（資料に無い人物なら undefined） */
export function relationsOf(characters: Character[], centerId: string): MaterialRelations | undefined {
  const center = characters.find((person) => person.id === centerId);
  if (!center) return undefined;
  const graph = buildRelationGraph(characters);
  const ego = egoGraph(graph, centerId, 1);
  const rows: RelationRow[] = [];
  for (const node of ego.nodes) {
    if (node.ring !== 1) continue;
    const edge = ego.edges.find((candidate) => (candidate.a === centerId && candidate.b === node.id) || (candidate.b === centerId && candidate.a === node.id));
    if (!edge) continue;
    const reason = node.provisional ? graph.unresolved.find((entry) => entry.targetName === node.name)?.reason : undefined;
    rows.push({
      id: node.id,
      name: node.name,
      provisional: node.provisional,
      ...(node.provisional ? { missing: reason === "ambiguous" ? "同じ名前の人物が複数いて決められない相手" : "資料に無い相手" } : {}),
      fromCenter: wordsOf(edge, centerId),
      toCenter: wordsOf(edge, node.id),
    });
  }
  return { name: center.name, rows };
}

/** 作品の登場人物を読んで、その人物の関係を返す（壊れたファイルは飛ばす。本体の相関図と同じ） */
export async function readMaterialRelations(store: FileStore, settingsDir: string, id: string): Promise<MaterialRelations | undefined> {
  const characters = await readKind(store, settingsDir, "characters", parseCharacter, []);
  return relationsOf(characters, id);
}
