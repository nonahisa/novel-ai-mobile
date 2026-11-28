import type { Speaker } from "../platform/speech";
import { escapeHtml, renderAppBar } from "./menuScreen";

/**
 * **読み上げの速さと声**（［ほか］→［設定］→［読み上げ］。2026-11-29 作者の答え「［ほか］→［設定］に置く（選んだものは覚えておく）」）。
 *
 * - 速さは本体の読み上げの列と同じ8段（0.5〜2）。覚えた値が段に無ければ、いちばん近い段にそろえる（本体の `aloudApplyRate`）
 * - 声はこの端末に入っている日本語の声から選ぶ（本体と同じく日本語の声だけ）。空は「端末の決まりの声」。覚えた声が端末に無くなって
 *   いたら、決まりの声で読む（読み上げは止めない）
 * - 端末ごとに覚える（同期しない。本文の書体・見た目と同じ `localStorage`）
 */
export const ALOUD_RATE_KEY = "novelai.readAloud.rate";
export const ALOUD_VOICE_KEY = "novelai.readAloud.voice";
export const ALOUD_RATES: readonly number[] = [0.5, 0.7, 0.85, 1, 1.15, 1.3, 1.5, 2];

export interface AloudPrefs {
  rate: number;
  /** 声の名前（空は端末の決まりの声） */
  voice: string;
}

/** 端末の日本語の声の1つ */
export interface AloudVoice {
  id: string;
  label: string;
}

export function parseAloudRate(raw: string | null | undefined): number {
  const value = Number(raw);
  if (raw === null || raw === undefined || raw === "" || !Number.isFinite(value)) return 1;
  return ALOUD_RATES.reduce((best, at) => (Math.abs(at - value) < Math.abs(best - value) ? at : best), ALOUD_RATES[0]!);
}

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem"> | undefined;

export function readAloudPrefs(storage: Store): AloudPrefs {
  let rate = 1;
  let voice = "";
  try {
    rate = parseAloudRate(storage?.getItem(ALOUD_RATE_KEY));
    voice = storage?.getItem(ALOUD_VOICE_KEY) ?? "";
  } catch {
    /* 読めなければ決まりのまま */
  }
  return { rate, voice };
}

export function writeAloudRate(storage: Store, rate: number): void {
  try {
    storage?.setItem(ALOUD_RATE_KEY, String(parseAloudRate(String(rate))));
  } catch {
    /* 覚えられなくても、この画面の選びは替わる */
  }
}

export function writeAloudVoice(storage: Store, voice: string): void {
  try {
    if (voice) storage?.setItem(ALOUD_VOICE_KEY, voice);
    else storage?.removeItem(ALOUD_VOICE_KEY);
  } catch {
    /* 同上 */
  }
}

/**
 * 画面の中身。`voices` は端末の日本語の声（`undefined` は調べている途中、文字列は使えない訳）。
 * 速さは2段の4つずつ（電話の幅に収める）
 */
export function renderAloudSettings(prefs: AloudPrefs, voices: readonly AloudVoice[] | string | undefined): string {
  const rate = (value: number) => `<button data-aloud-rate="${value}" aria-pressed="${prefs.rate === value}">${value}</button>`;
  const rates = `<div class="seg aloud-rates">${ALOUD_RATES.slice(0, 4).map(rate).join("")}</div><div class="seg aloud-rates">${ALOUD_RATES.slice(4).map(rate).join("")}</div>`;
  let voicePart: string;
  if (voices === undefined) voicePart = `<p class="aloud-voices-busy" aria-busy="true">声を調べています…</p>`;
  else if (typeof voices === "string") voicePart = `<p class="flag warn long">${escapeHtml(voices)}</p>`;
  else {
    const known = prefs.voice === "" || voices.some((voice) => voice.id === prefs.voice);
    const chosen = known ? prefs.voice : "";
    const button = (id: string, label: string) =>
      `<button type="button" data-aloud-voice="${escapeHtml(id)}" aria-pressed="${chosen === id}">${escapeHtml(label)}</button>`;
    voicePart =
      (known ? "" : `<p class="flag warn long">前に選んだ声がこの端末に見つかりません。端末の決まりの声で読みます</p>`) +
      `<div class="seg aloud-voices">${button("", "端末の決まりの声")}${voices.map((voice) => button(voice.id, voice.label)).join("")}</div>`;
  }
  return (
    `<section class="menu-section"><h2>速さ</h2>${rates}</section>` +
    `<section class="menu-section"><h2>声</h2>${voicePart}</section>` +
    `<section class="menu-section"><button type="button" class="menu-item built" id="aloudTry">試しに聞く</button></section>`
  );
}

/** 試しに聞く文 */
export const ALOUD_TRY_TEXT = "読み上げの試しです。この速さと声で、原稿を読みます。";

export interface AloudSettingsDeps {
  storage: Store;
  speaker: Speaker;
  stillHere: () => boolean;
  toast: (message: string) => void;
}

/** ［ほか］→［設定］→［読み上げ］の画面。選ぶとすぐ覚える */
export function mountAloudSettings(screen: HTMLElement, deps: AloudSettingsDeps): void {
  screen.innerHTML = `${renderAppBar("読み上げ", { back: true })}<div id="aloudSettings"></div>`;
  const slot = screen.querySelector<HTMLElement>("#aloudSettings")!;
  let voices: readonly AloudVoice[] | string | undefined;
  const paint = () => {
    if (deps.stillHere()) slot.innerHTML = renderAloudSettings(readAloudPrefs(deps.storage), voices);
  };
  paint();
  void (async () => {
    const reason = await deps.speaker.unavailable();
    voices = reason ?? (await deps.speaker.voices());
    paint();
  })();
  slot.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    const rate = target.closest<HTMLElement>("[data-aloud-rate]")?.dataset.aloudRate;
    if (rate !== undefined) {
      writeAloudRate(deps.storage, Number(rate));
      return paint();
    }
    const voice = target.closest<HTMLElement>("[data-aloud-voice]")?.dataset.aloudVoice;
    if (voice !== undefined) {
      writeAloudVoice(deps.storage, voice);
      return paint();
    }
    if (target.closest("#aloudTry")) {
      void (async () => {
        const reason = await deps.speaker.unavailable();
        if (reason) return deps.toast(reason);
        const prefs = readAloudPrefs(deps.storage);
        deps.speaker.stop();
        await deps.speaker.speak(ALOUD_TRY_TEXT, prefs.rate, prefs.voice || undefined);
      })();
    }
  });
}
