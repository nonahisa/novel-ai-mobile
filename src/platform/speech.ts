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
  /** 1文を読む。読み終えたら "done"、止めた・読めなかったら "stopped" */
  speak(text: string, rate: number): Promise<SpeakEnd>;
  stop(): void;
}

export const NO_JAPANESE_VOICE = "この端末には日本語の読み上げの声が見つかりません（端末の設定の「テキスト読み上げ」で日本語の声を入れると使えます）";

/** iOS・ブラウザ：Web Speech API */
export class WebSpeaker implements Speaker {
  private voice: SpeechSynthesisVoice | undefined;
  private current: { resolve: (end: SpeakEnd) => void } | undefined;

  private async japaneseVoice(): Promise<SpeechSynthesisVoice | undefined> {
    if (typeof speechSynthesis === "undefined") return undefined;
    const pick = () => speechSynthesis.getVoices().find((voice) => voice.lang.toLowerCase().startsWith("ja"));
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

  speak(text: string, rate: number): Promise<SpeakEnd> {
    return new Promise((resolve) => {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = "ja-JP";
      if (this.voice) utterance.voice = this.voice;
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
  speak(options: { text: string; rate: number }): Promise<{ end: SpeakEnd }>;
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

  async speak(text: string, rate: number): Promise<SpeakEnd> {
    try {
      return (await this.plugin.speak({ text, rate })).end === "done" ? "done" : "stopped";
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
