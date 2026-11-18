/**
 * **作り物の作品を片づける**（試しの画面 10。2026-11-19 母艦：Mac が作者の iPad mini 実機で試したあと、
 * 作り物の作品「灯台守の手紙_確認用」がアプリの中に残った。devicectl では消せず、［登録から外す］は GitHub と結んでいない
 * 作品を外さない（作者の決定）。アプリを消すと作者の作品も消える）。
 *
 * 消してよいのは、確かめに使う作り物だけ：`works/` の**すぐ下**の、名前が `_確認用` で終わるフォルダー。
 * 書庫の中・名前の途中に `_確認用` があるもの・隠しフォルダーは選ばない
 */
export const TEST_WORK_SUFFIX = "_確認用";

export function pickTestWorkFolders(names: readonly string[]): string[] {
  return names
    .filter((name) => !name.startsWith(".") && !name.includes("/") && name.endsWith(TEST_WORK_SUFFIX) && name.length > TEST_WORK_SUFFIX.length)
    .sort();
}
