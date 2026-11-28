import { Capacitor } from "@capacitor/core";
import { Directory, Encoding, Filesystem } from "@capacitor/filesystem";
import { createFailureLog, noteFailure, setFailureLog, type FailureLog } from "../platform/failureLog";

/**
 * 失敗の記録（`platform/failureLog.ts`）を、アプリの領域のファイルに置く。
 *
 * - Android：アプリ専用の領域（Directory.Data）。ほかのアプリからは見えない
 * - iOS：Library（Directory.LibraryNoCloud）。Documents（Data）には置かない。iCloud にも写さない
 * - 作品のフォルダーの外なので、同期には乗らない
 */
export const FAILURE_LOG_PATH = "failure-log/actions.log";

const directory = () => (Capacitor.getPlatform() === "ios" ? Directory.LibraryNoCloud : Directory.Data);

export function startFailureLog(): FailureLog {
  const log = createFailureLog({
    async read() {
      try {
        const got = await Filesystem.readFile({ path: FAILURE_LOG_PATH, directory: directory(), encoding: Encoding.UTF8 });
        return typeof got.data === "string" ? got.data : undefined;
      } catch {
        return undefined; // まだ無い
      }
    },
    async write(text) {
      await Filesystem.writeFile({
        path: FAILURE_LOG_PATH,
        data: text,
        directory: directory(),
        encoding: Encoding.UTF8,
        recursive: true,
      });
    },
  });
  setFailureLog(log);
  return log;
}

/** 画面のコードが受け止めなかった例外も残す（何をしていたかは分からないので「画面の例外」とする） */
export function watchUncaughtFailures(target: Window): void {
  target.addEventListener("error", (event) => {
    noteFailure("画面の例外", event.error ?? event.message);
  });
  target.addEventListener("unhandledrejection", (event) => {
    noteFailure("画面の例外（待ちの途中）", event.reason);
  });
}
