import { describe, expect, it } from "vitest";
import { aloudStartIndex, readingPlanFor, runAloud } from "../src/app/readAloud";
import type { SpeakEnd, Speaker } from "../src/platform/speech";

/**
 * ［…］→ 読み上げ（本体の設計書 6.42）。文の区切りと声に渡す写しは本体の `buildReadingPlan`。
 * 端末の声は差し替えられる形（`Speaker`）にして、ここでは偽の声で流れだけを見る
 */
class FakeSpeaker implements Speaker {
  spoken: string[] = [];
  private pending?: (end: SpeakEnd) => void;
  async unavailable(): Promise<string | undefined> {
    return undefined;
  }
  speak(text: string): Promise<SpeakEnd> {
    this.spoken.push(text);
    return new Promise((resolve) => (this.pending = resolve));
  }
  finish(): void {
    const done = this.pending;
    this.pending = undefined;
    done?.("done");
  }
  stop(): void {
    const done = this.pending;
    this.pending = undefined;
    done?.("stopped");
  }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("読む文の計画と読み始め", () => {
  const text = "姉から{手紙|てがみ}が届いた。灯台は遠い。\n// 付箋：ここは後で直す\n霧が出た。";

  it("ルビは読みで、付箋の行は読まない（本体の計画のまま。.md は {漢字|かんじ} の記法）", () => {
    const plan = readingPlanFor(text, "灯台守_確認用/本文/第1話 手紙.md");
    expect(plan.sentences.map((s) => s.speech)).toEqual(["姉からてがみが届いた。", "灯台は遠い。", "霧が出た。"]);
  });

  it("カーソルのある文から読む。末尾なら頭から", () => {
    const plan = readingPlanFor(text, "第1話.md");
    expect(aloudStartIndex(plan, 0)).toBe(0);
    expect(aloudStartIndex(plan, text.indexOf("灯台"))).toBe(1);
    expect(aloudStartIndex(plan, text.indexOf("霧"))).toBe(2);
    expect(aloudStartIndex(plan, text.length)).toBe(0);
  });

  it("頭の欄（カクヨム形式）にカーソルがあれば、題から読む", () => {
    const episode = "【タイトル】\n手紙\n【公開状態】\n公開\n【本文】\n姉から手紙が届いた。";
    const plan = readingPlanFor(episode, "第1話.txt");
    expect(plan.sentences.map((s) => s.speech)).toEqual(["手紙", "姉から手紙が届いた。"]);
    expect(aloudStartIndex(plan, episode.indexOf("公開\n"))).toBe(0);
  });
});

describe("順に読み、［止める］で止まる", () => {
  it("1文ずつ渡し、読み終えたら次へ。最後まで読んだら終わる", async () => {
    const plan = readingPlanFor("一つ目。二つ目。", "a.md");
    const speaker = new FakeSpeaker();
    const seen: number[] = [];
    const run = runAloud(speaker, plan, 0, { rate: 1, onSentence: (index) => seen.push(index) });
    await tick();
    speaker.finish();
    await tick();
    speaker.finish();
    expect(await run.finished).toBe("done");
    expect(speaker.spoken).toEqual(["一つ目。", "二つ目。"]);
    expect(seen).toEqual([0, 1]);
  });

  it("止めたら、その先は渡さない", async () => {
    const plan = readingPlanFor("一つ目。二つ目。三つ目。", "a.md");
    const speaker = new FakeSpeaker();
    const run = runAloud(speaker, plan, 1, { rate: 1, onSentence: () => undefined });
    await tick();
    run.stop();
    expect(await run.finished).toBe("stopped");
    await tick();
    expect(speaker.spoken).toEqual(["二つ目。"]);
  });
});
