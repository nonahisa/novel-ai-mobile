/** `syncConflict.test.ts` を、`.git` を覚える置き場（`steadyGitDir`）でもう一度流す（`support/steadyGitFs.ts`） */
(globalThis as { __steadyGitDir?: boolean }).__steadyGitDir = true;
await import("./syncConflict.test");
