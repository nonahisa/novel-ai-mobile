import { Capacitor, registerPlugin } from "@capacitor/core";

/**
 * **端末の声**（読み上げ。本体の設計書 6.42「声は OS のもの」。モバイル版の設計書 3章 #11「読み上げは端末の読み上げ」）。
 *
 * - Android：WebView に `speechSynthesis` が無いので、アプリの中の口（`ReadAloudPlugin.java`。端末の TextToSpeech）
 * - iOS・ブラウザ：Web Speech API の `speechSynthesis`
 *
 * **日本語の声だけで読む**（本体と同じ。日本語以外の声で無理に読まない）。無ければ押せなくして訳を出す。
 * AI もネットワークも使わず、料金もかからない。止めるのは `stop()` だけ（本体と同じく一時停止は使わない）
 */
export type SpeakEnd = "done" | "stopped";

export interface Speaker {
  /** 使えないときの訳（使えれば undefined） */
  unavailable(): Promise<string | undefined>;
  /**
   * 1文を読む。読み終えたら "done"、止めた・読めなかったら "stopped"。`voice` は声の名前（［設定］→［読み上げ］で選んだもの。
   * 空・端末に無いときは端末の決まりの日本語の声）
   */
  speak(text: string, rate: number, voice?: string): Promise<SpeakEnd>;
  /** この端末の日本語の声（名前と見出し） */
  voices(): Promise<SpeakerVoice[]>;
  stop(): void;
}

export interface SpeakerVoice {
  id: string;
  label: string;
}

export const NO_JAPANESE_VOICE = "この端末には日本語の読み上げの声が見つかりません（端末の設定の「テキスト読み上げ」で日本語の声を入れると使えます）";

/** 声の見分けに使う所だけ（`SpeechSynthesisVoice` の一部。試験で作れるように） */
export interface WebVoiceLike {
  name: string;
  voiceURI: string;
  lang: string;
}

const QUALITY: ReadonlyArray<[RegExp, string]> = [
  [/premium/i, "最高品質"],
  [/enhanced/i, "高品質"],
  [/compact/i, "標準"],
];

/**
 * 設定の画面に並べる日本語の声（iOS・ブラウザ）。**鍵は voiceURI**（2026-11-29 Mac が iPad mini 6 で見つけた：「Kyoko」が
 * 標準と高品質で2つあり、名前では見分けられない）。同じ名前が2つ以上あれば、voiceURI から品質を読んで見出しに添える
 * （読めなければ番号）
 */
export function webVoiceChoices(voices: readonly WebVoiceLike[]): SpeakerVoice[] {
  // 同じ声（鍵が同じ）が2回届いたら1つにする（選んでも見分けられない）
  const byId = new Map<string, WebVoiceLike>();
  for (const voice of voices) {
    if (!voice.lang.toLowerCase().startsWith("ja")) continue;
    const id = voice.voiceURI || voice.name;
    if (!byId.has(id)) byId.set(id, voice);
  }
  const named = new Map<string, number>();
  for (const voice of byId.values()) named.set(voice.name, (named.get(voice.name) ?? 0) + 1);
  // 同じ名前なら品質を添える。品質を添えても同じ見出しになる（どちらも「標準」。2026-11-29 iPad mini 6 の 0.2.5）なら番号も添える
  const rows = [...byId].map(([id, voice]) => {
    const quality = (named.get(voice.name) ?? 0) > 1 ? QUALITY.find(([pattern]) => pattern.test(voice.voiceURI))?.[1] : undefined;
    const shared = (named.get(voice.name) ?? 0) > 1;
    return { id, name: voice.name, quality, base: shared ? `${voice.name}（${quality ?? ""}）` : voice.name, shared };
  });
  const sameBase = new Map<string, number>();
  for (const row of rows) sameBase.set(row.base, (sameBase.get(row.base) ?? 0) + 1);
  const order = new Map<string, number>();
  return rows.map((row) => {
    if (!row.shared) return { id: row.id, label: row.name };
    if ((sameBase.get(row.base) ?? 0) < 2) return { id: row.id, label: row.base };
    const n = (order.get(row.base) ?? 0) + 1;
    order.set(row.base, n);
    return { id: row.id, label: row.quality ? `${row.name}（${row.quality}・${n}）` : `${row.name}（${n}）` };
  });
}

/** 覚えた声を引く。voiceURI で探し、無ければ名前（0.2.4 は名前で覚えていた）で最初の声 */
export function findWebVoice<T extends WebVoiceLike>(voices: readonly T[], id: string): T | undefined {
  return voices.find((voice) => voice.voiceURI === id) ?? voices.find((voice) => voice.name === id);
}

/** iOS・ブラウザ：Web Speech API */
export class WebSpeaker implements Speaker {
  private voice: SpeechSynthesisVoice | undefined;
  private current: { resolve: (end: SpeakEnd) => void } | undefined;

  private japaneseVoices(): SpeechSynthesisVoice[] {
    return speechSynthesis.getVoices().filter((voice) => voice.lang.toLowerCase().startsWith("ja"));
  }

  private async japaneseVoice(): Promise<SpeechSynthesisVoice | undefined> {
    if (typeof speechSynthesis === "undefined") return undefined;
    const pick = () => this.japaneseVoices()[0];
    const now = pick();
    if (now) return now;
    // 声の一覧は遅れて届く（`voiceschanged`）。来なければ「無い」
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(pick()), 1500);
      speechSynthesis.addEventListener(
        "voiceschanged",
        () => {
          clearTimeout(timer);
          resolve(pick());
        },
        { once: true }
      );
    });
  }

  async unavailable(): Promise<string | undefined> {
    if (typeof speechSynthesis === "undefined") return "この端末では読み上げを使えません";
    this.voice = await this.japaneseVoice();
    return this.voice ? undefined : NO_JAPANESE_VOICE;
  }

  async voices(): Promise<SpeakerVoice[]> {
    if (typeof speechSynthesis === "undefined") return [];
    if (!(await this.japaneseVoice())) return [];
    return webVoiceChoices(this.japaneseVoices());
  }

  speak(text: string, rate: number, voiceName?: string): Promise<SpeakEnd> {
    return new Promise((resolve) => {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = "ja-JP";
      const chosen = voiceName ? findWebVoice(this.japaneseVoices(), voiceName) : undefined;
      const voice = chosen ?? this.voice;
      if (voice) utterance.voice = voice;
      utterance.rate = rate;
      // 止めたあとに遅れて届く end・error は、次の文のものと取り違えない（この文の印で見分ける）
      const token = { resolve };
      this.current = token;
      const finish = (end: SpeakEnd) => {
        if (this.current !== token) return;
        this.current = undefined;
        resolve(end);
      };
      utterance.onend = () => finish("done");
      utterance.onerror = () => finish("stopped");
      speechSynthesis.speak(utterance);
    });
  }

  stop(): void {
    const current = this.current;
    this.current = undefined;
    if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
    current?.resolve("stopped");
  }
}

interface ReadAloudPlugin {
  check(): Promise<{ available: boolean }>;
  speak(options: { text: string; rate: number; voice?: string }): Promise<{ end: SpeakEnd }>;
  voices(): Promise<{ voices: { name: string; network: boolean }[] }>;
  stop(): Promise<void>;
}

/** Android：アプリの中の口（端末の TextToSpeech） */
export class NativeSpeaker implements Speaker {
  private readonly plugin = registerPlugin<ReadAloudPlugin>("ReadAloud");

  async unavailable(): Promise<string | undefined> {
    try {
      return (await this.plugin.check()).available ? undefined : NO_JAPANESE_VOICE;
    } catch {
      return "この端末では読み上げを使えません";
    }
  }

  async voices(): Promise<SpeakerVoice[]> {
    try {
      // Android の声の名前は「ja-jp-x-htm-local」の形。ネットが要る声は見出しにそう添える
      return (await this.plugin.voices()).voices.map((voice) => ({ id: voice.name, label: voice.network ? `${voice.name}（ネットが要る）` : voice.name }));
    } catch {
      return [];
    }
  }

  async speak(text: string, rate: number, voice?: string): Promise<SpeakEnd> {
    try {
      return (await this.plugin.speak({ text, rate, ...(voice ? { voice } : {}) })).end === "done" ? "done" : "stopped";
    } catch {
      return "stopped";
    }
  }

  stop(): void {
    void this.plugin.stop().catch(() => undefined);
  }
}

export function deviceSpeaker(): Speaker {
  return Capacitor.getPlatform() === "android" ? new NativeSpeaker() : new WebSpeaker();
}
