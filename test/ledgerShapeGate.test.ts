import { describe, expect, test } from "vitest";
import { compareSchemaVersions, ledgerShapeProblem } from "../src/platform/ledgerShapeGate";

/** 台帳の形の関所（2026-11-21 作者の答え「台帳の形が変わったときだけ止める」） */
describe("台帳の形の関所", () => {
  test("形の版を数として比べる（0.10 は 0.9 より新しい）", () => {
    expect(compareSchemaVersions("0.10", "0.9")).toBeGreaterThan(0);
    expect(compareSchemaVersions("1", "1.0")).toBe(0);
    expect(compareSchemaVersions("0.1", "1")).toBeLessThan(0);
  });

  test("同じ・古い・書かれていない・まだ無い・壊れている（別の口が止める）ときは書いてよい", () => {
    expect(ledgerShapeProblem("章立て", '{"schemaVersion":"1","chapters":[]}', "1")).toBeUndefined();
    expect(ledgerShapeProblem("作品の設定", '{"schemaVersion":"0.1"}', "0.2")).toBeUndefined();
    expect(ledgerShapeProblem("作品の設定", '{"workTitle":"灯台守"}', "0.1")).toBeUndefined();
    expect(ledgerShapeProblem("章立て", undefined, "1")).toBeUndefined();
    expect(ledgerShapeProblem("章立て", "{ 壊れ", "1")).toBeUndefined();
    expect(ledgerShapeProblem("読まない語", '{"schemaVersion":1}', 1)).toBeUndefined();
  });

  test("知っている版より新しい・数として読めない版なら書かない。理由に台帳と版を出す", () => {
    expect(ledgerShapeProblem("章立て", '{"schemaVersion":"2","chapters":[]}', "1")).toContain("章立ての形が新しくなっています（形の版 2。モバイル版は 1 まで）");
    expect(ledgerShapeProblem("各話あらすじ", '{"schemaVersion":"0.2"}', "0.1")).toContain("この台帳は書きません");
    expect(ledgerShapeProblem("作品の設定", '{"schemaVersion":"2a"}', "0.1")).toContain("形の版 2a");
  });
});
