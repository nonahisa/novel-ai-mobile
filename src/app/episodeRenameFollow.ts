import { LAST_EPISODE_KEY, RECENT_EPISODES_KEY, encodeLastEpisode, readLastEpisode, readRecentEpisodes } from "./lastEpisode";
import { kindOf, proposalId, readProposals, writeProposals } from "./typoProposals";

/**
 * **話の名前を変えたとき、この端末の中だけの記録も新しい名前へ**（2026-11-21。台帳の付け替えは `platform/episodeRename.ts`）。
 * パスで話を指しているもの：［提案］の指摘（`novelai.proposals.typo`）・最後に開いた話・最近開いた話。
 * 名前だけを変え、中身（指摘・並び）は変えない。書きかけの控えがある話は、そもそも名前を変えない（`episodeRename.ts`）
 */
export function followRenameOnDevice(storage: Storage | undefined, root: string, from: string, to: string): void {
  if (!storage) return;
  try {
    const proposals = readProposals(storage);
    if (proposals.some((item) => item.root === root && item.path === from)) {
      writeProposals(
        storage,
        proposals.map((item) => {
          if (item.root !== root || item.path !== from) return item;
          const moved = { ...item, path: to };
          return { ...moved, id: proposalId(moved, kindOf(item)) };
        })
      );
    }
    const last = readLastEpisode(storage);
    if (last && last.root === root && last.path === from) storage.setItem(LAST_EPISODE_KEY, encodeLastEpisode({ root, path: to }));
    const recent = readRecentEpisodes(storage);
    if (recent.some((item) => item.root === root && item.path === from)) {
      storage.setItem(RECENT_EPISODES_KEY, JSON.stringify(recent.map((item) => (item.root === root && item.path === from ? { root, path: to } : item))));
    }
  } catch {
    /* 覚え直せなくても、名前を変えたことは止めない（開き直せば覚え直す） */
  }
}
