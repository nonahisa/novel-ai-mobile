import { Capacitor, registerPlugin } from "@capacitor/core";

/**
 * **長い AI の処理を、アプリを裏に回しても続ける**（段2。設計書 7章。作者の決定 2026-10-31「続ける」）。
 *
 * Android では、処理のあいだ前面サービス（`android/.../AiWorkService.java`）を動かし、通知に進み具合を出す。
 * 仕事そのもの（AI を呼ぶ・指摘を書く）はこれまでどおり画面が続ける。前面サービスがあるあいだ、Android は
 * アプリのプロセスを凍らせない・止めない。
 *
 * iOS とブラウザでは何もしない（iOS は前面サービスが無く、裏に回ると数十秒で止まる。iOS の裏の処理は別の作りで、まだ作らない）。
 * 前面サービスを始められなくても、仕事は止めない（前面にいるあいだは続く）
 */

export interface BackgroundWork {
  start(title: string, text: string, max: number): Promise<void>;
  update(text: string, progress: number, max: number): Promise<void>;
  stop(): Promise<void>;
}

interface AiWorkPlugin {
  start(options: { title: string; text: string; progress: number; max: number }): Promise<void>;
  update(options: { title: string; text: string; progress: number; max: number }): Promise<void>;
  stop(): Promise<void>;
}

const NONE: BackgroundWork = {
  start: async () => undefined,
  update: async () => undefined,
  stop: async () => undefined,
};

let plugin: AiWorkPlugin | undefined;

/** 端末に合った口（Android だけ前面サービス。ほかは何もしない） */
export function backgroundWork(): BackgroundWork {
  if (Capacitor.getPlatform() !== "android") return NONE;
  plugin ??= registerPlugin<AiWorkPlugin>("AiWork");
  const native = plugin;
  let title = "AI の処理";
  // どの口が失敗しても仕事は止めない（通知が出ないだけ）
  return {
    start: async (nextTitle, text, max) => {
      title = nextTitle;
      await native.start({ title, text, progress: 0, max }).catch(() => undefined);
    },
    update: async (text, progress, max) => {
      await native.update({ title, text, progress, max }).catch(() => undefined);
    },
    stop: async () => {
      await native.stop().catch(() => undefined);
    },
  };
}

/**
 * 仕事のあいだ前面サービスを動かす。`step(done)` で進み具合（「AI に見せています 3/12」）を通知に出す。
 * **成功でも失敗でも中止でも、終わったら必ず止める**（止め忘れると、通知が残り続ける）
 */
export async function whileWorking<T>(work: BackgroundWork, title: string, total: number, task: (step: (done: number) => void) => Promise<T>): Promise<T> {
  await work.start(title, `AI に見せています（0/${total}）`, total);
  try {
    return await task((done) => void work.update(`AI に見せています（${done}/${total}）`, done, total));
  } finally {
    await work.stop();
  }
}
