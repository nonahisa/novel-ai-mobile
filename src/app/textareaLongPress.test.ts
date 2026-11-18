import { describe, expect, it } from "vitest";
import { wantsIosTextareaFixes } from "./textareaLongPress";

describe("左の線の長押しの手当てを使うか", () => {
  const store = (value: string | null) => ({ getItem: () => value });
  it("iOS では使う", () => expect(wantsIosTextareaFixes("ios", store(null))).toBe(true));
  it("Android とブラウザでは使わない（端末の長押しで選べる）", () => {
    expect(wantsIosTextareaFixes("android", store(null))).toBe(false);
    expect(wantsIosTextareaFixes("web", undefined)).toBe(false);
  });
  it("試しの印があればブラウザでも使う", () => expect(wantsIosTextareaFixes("web", store("1"))).toBe(true));
});
