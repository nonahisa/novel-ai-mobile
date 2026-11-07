import { ACTION_TREE, isItemShownInActionList, type ActionGroup, type ActionItem } from "../shared";

/**
 * **予定している画面とメニューの並べ方**（Android詳細設計書 4.3・4.4.1〜4.4.3 の【案】。
 * `docs/試作/メニュー試作.html` と同じ並べ方）。
 *
 * 作者の頼み（2026-11-07）：「予定されている画面（メニュー構造（未開発グレーアウト化））」。
 * 【案】はまだ決まっていないので、**作者が触って決める材料**として、案のとおりに全部並べる。
 * まだ作っていない項目は押せない形（灰色）にし、押したら「まだ作っていません」と出す。
 * 作ってある項目（`built`）だけが画面を開く。
 *
 * 画面の描き方は `menuScreen.ts`。ここは中身（何をどこに置くか）だけを持ち、テストで見張る。
 */

/** 開ける画面 */
export type ScreenId = "tategaki" | "check" | "allActions";

/** メニューの1項目 */
export interface PlannedItem {
  label: string;
  /** 押したときに出す補足（どこに置く予定か・何をする所か） */
  note?: string;
  /** 作ってあれば、開く画面 */
  built?: ScreenId;
  /** 本体の詳細メニューの操作を名指しするとき（「すべての機能」と同じ名前） */
  action?: string;
}

/** 画面の中のまとまり */
export interface PlannedSection {
  title: string;
  /** どこから出すか（長押し・右下の［＋］など。設計書 4.4.1 の段） */
  how?: string;
  items: PlannedItem[];
}

/** 下のタブ（設計書 4.3 の狭い段。4つ） */
export interface PlannedTab {
  id: "works" | "write" | "proposals" | "other";
  label: string;
  /** そのタブの画面（作品一覧など）の名前と、まだ作っていないか */
  screen: string;
  sections: PlannedSection[];
}

export const TABS: readonly PlannedTab[] = [
  {
    id: "works",
    label: "作品",
    screen: "作品一覧（A）・話の一覧（B）",
    sections: [
      {
        title: "作品を足す",
        how: "右下の［＋］（4.4.3）",
        items: [
          { label: "GitHub から取り寄せる", action: "GitHubから追加", note: "パソコンで書いている作品を持ってくる（浅い取得）" },
          { label: "新しく作る", action: "本文起点", note: "題を入れるだけで作る。GitHub に置き場を作るかは後で訊く" },
        ],
      },
      {
        title: "作品の長押し",
        how: "作品を長押し（4.4.1 の2段目）",
        items: [
          { label: "題を変える", action: "作品名変更" },
          { label: "登録から外す", note: "GitHub の置き場は消さない" },
          { label: "シリーズ", action: "シリーズ連結" },
          { label: "作品の設定", note: "形式・ジャンル・作品の種類・投稿サイトなど" },
        ],
      },
      {
        title: "話の長押し",
        how: "話の一覧で話を長押し（4.4.1 の2段目）",
        items: [
          { label: "誤字脱字", action: "誤字脱字検知" },
          { label: "推敲", action: "推敲" },
          { label: "あらすじ", action: "各話あらすじ" },
        ],
      },
      {
        title: "同期",
        items: [{ label: "保存・同期", action: "保存・同期", note: "GitHub の API で送る（引継ぎ書 11章。部品はできた。画面はまだ）" }],
      },
    ],
  },
  {
    id: "write",
    label: "書く",
    screen: "原稿エディター（C）",
    sections: [
      {
        title: "試し",
        items: [
          {
            label: "縦書き・横書きの試し",
            built: "tategaki",
            note: "A（いまの形・変換中の線は左）と B（右傍線）を切り替えて書き比べる。ルビ・傍点・字数・保存と読み戻しも",
          },
        ],
      },
      {
        title: "原稿",
        items: [{ label: "話を開いて書く", note: "最後に開いた話を開く（4.3）" }],
      },
      {
        title: "上のバーの［…］",
        how: "上のバーの［…］（4.4）",
        items: [
          { label: "新しい話", note: "話を1つ足す" },
          { label: "章を立てる", action: "章立て提案" },
          { label: "書き出し", note: "投稿用・設定資料集など" },
          { label: "AI を走らせる", note: "誤字脱字・推敲・矛盾検知など。結果は［提案］へ" },
          { label: "AI に相談", action: "AIに相談" },
        ],
      },
      {
        title: "字を選んだときの帯",
        how: "原稿で字を選ぶ（4.4）",
        items: [
          { label: "ルビ", action: "ルビ付与", note: "縦書きの試しでは {漢字|かんじ} と打つと表示を見られる" },
          { label: "傍点", action: "傍点付与", note: "縦書きの試しでは {{語}} と打つと表示を見られる" },
          { label: "資料を見る", action: "設定資料集閲覧" },
          { label: "AI に訊く" },
        ],
      },
    ],
  },
  {
    id: "proposals",
    label: "提案",
    screen: "提案の一覧（D）",
    sections: [
      {
        title: "提案",
        how: "AI の指摘・設定資料の更新案がここに集まる。タブに未決の件数を付ける（4.3）",
        items: [
          { label: "提案の一覧", note: "話ごと・種類ごとに並べる" },
          { label: "採る" },
          { label: "見送る" },
          { label: "まとめて採る・見送る" },
          { label: "編集者の提案", note: "最初の版では作らない（3章 #13）" },
        ],
      },
    ],
  },
  {
    id: "other",
    label: "ほか",
    screen: "ほか（E〜I）",
    sections: [
      {
        title: "探して呼ぶ",
        how: "4.4.1 の3段目",
        items: [
          { label: "すべての機能", built: "allActions", note: "検索欄つきの一覧。名前は本体の詳細メニューと同じ字" },
          { label: "AI に相談", action: "AIに相談", note: "「表記ゆれを見て」と頼めばその場で動く" },
          { label: "簡単ステップメニュー", note: "次にやることの案内" },
        ],
      },
      {
        title: "作品の資料",
        items: [
          { label: "プロット", action: "プロット自力作成" },
          { label: "設定資料", action: "設定資料集閲覧" },
          { label: "執筆統計", action: "執筆統計", note: "今日の字数だけは作品一覧の上にも出す" },
          { label: "書き出し・広報", action: "新話投稿" },
        ],
      },
      {
        title: "設定",
        how: "［ほか］→ 設定（H）",
        items: [
          { label: "AI", action: "AI設定", note: "使う AI・鍵・機能ごとの割り当て" },
          { label: "GitHub と同期", note: "アカウント・同期（6章）" },
          { label: "表示", note: "書体・字の大きさ・縦横の既定" },
          { label: "確認省略解除・初回設定" },
        ],
      },
      {
        title: "ヘルプ",
        items: [
          { label: "使い方", action: "使い方" },
          { label: "動作確認ページ", built: "check", note: "縦書き・ルビ・保存・通信・git の確かめ（開発用）" },
          { label: "バージョン確認", built: "check", action: "バージョン確認", note: "動作確認ページの1番に出る" },
        ],
      },
    ],
  },
];

/* ---------- すべての機能（4.4.1 の3段目） ---------- */

/** 「すべての機能」の1行 */
export interface ActionEntry {
  label: string;
  group: string;
  section?: string;
  detail: string;
  usesAI: boolean;
  /** 設計書 4.4.2 の置き場（どこから呼ぶ予定か） */
  place: string;
  /** 作ってあれば、開く画面 */
  built?: ScreenId;
}

/**
 * 端末で出さないもの（設計書 4.4.2・3章 #12・#13・4.4.3、試作の判断）。
 * 「端末で使えない操作は、どの段にも出さない」（4.4.1）。
 */
export const HIDDEN_ON_MOBILE: Readonly<Record<string, string>> = {
  電子出版等: "PDF の印刷と EPUB エディターは最初の版では作らない",
  "作品管理/編集者連携": "編集者連携は最初の版では作らない（3章 #13）",
  未登録作品検索: "端末ではフォルダーを選ばない（4.4.3）",
  フォルダー登録: "端末ではフォルダーを選ばない（4.4.3）",
  "Claude Code接続": "MCP サーバーを持たない（3章 #12）",
  外部AI指示書設置: "外の AI に作品を触らせるのはパソコンの側（3章 #12）",
  "外部AI許可／取消": "外の AI に作品を触らせるのはパソコンの側（3章 #12）",
  改行コード統一: "端末では改行を選ぶ場面が無い（試作での仮の判断）",
};

/** 大分類・小分類ごとの置き場（設計書 4.4.2 の表） */
export const PLACES: Readonly<Record<string, string>> = {
  執筆データ: "［ほか］→ 執筆統計",
  作品管理: "作品を長押し",
  "作品管理/新規執筆開始": "［作品］の［＋］→ 新しく作る",
  "作品管理/既存原稿登録": "［作品］の［＋］",
  "作品管理/クラウド取得": "［作品］の［＋］→ GitHub から取り寄せる",
  "作品管理/GitHub作品管理": "［ほか］→ 設定 → GitHub と同期",
  "作品管理/作品別設定": "作品を長押し → 作品の設定",
  新作構想: "［ほか］→ プロット",
  "作品執筆/相談・助言": "上のバーの［…］・「AI に相談」",
  "作品執筆/原稿整備": "［書く］の上のバーの［…］",
  自己校正: "話を長押し・［書く］の［…］→ AI を走らせる（結果は［提案］）",
  資料管理: "［ほか］→ 設定資料",
  投稿脱稿: "［ほか］→ 書き出し・広報",
  環境設定: "［ほか］→ 設定",
  "環境設定/初回設定": "［ほか］→ 設定のいちばん下",
  ヘルプ: "［ほか］→ ヘルプ",
};

/** 本体の操作のうち、モバイル版で作ってあるもの（名前 → 開く画面） */
export const BUILT_ACTIONS: Readonly<Record<string, ScreenId>> = {
  バージョン確認: "check",
};

function hiddenReason(label: string, group: string, section?: string): string | undefined {
  return HIDDEN_ON_MOBILE[label] ?? (section ? HIDDEN_ON_MOBILE[`${group}/${section}`] : undefined) ?? HIDDEN_ON_MOBILE[group];
}

function placeOf(group: string, section?: string): string {
  return (section ? PLACES[`${group}/${section}`] : undefined) ?? PLACES[group] ?? "［ほか］→ すべての機能";
}

/** 端末の一覧に載せるか（本体の判定に、端末の事情を足す） */
function shownOnMobile(item: ActionItem): boolean {
  // 端末は外のプロセスを起動できない（false）。ブラウザ版だけの操作・旧入口も出さない
  return isItemShownInActionList(item, false) && !item.browserOnly && !item.supersededBy;
}

/** 本体の詳細メニューの木を、端末の「すべての機能」の一覧にする */
export function buildActionList(tree: readonly ActionGroup[] = ACTION_TREE): ActionEntry[] {
  const out: ActionEntry[] = [];
  const push = (item: ActionItem, group: string, section?: string) => {
    if (!shownOnMobile(item) || hiddenReason(item.label, group, section)) return;
    out.push({
      label: item.label,
      group,
      section,
      detail: item.detail.trim(),
      usesAI: item.usesAI === true,
      place: placeOf(group, section),
      built: BUILT_ACTIONS[item.label],
    });
  };
  for (const group of tree) {
    if (hiddenReason("", group.label)) continue;
    for (const entry of group.entries) {
      if (entry.kind === "section") {
        if (hiddenReason("", group.label, entry.label)) continue;
        for (const item of entry.items) push(item, group.label, entry.label);
      } else {
        push(entry, group.label);
      }
    }
  }
  return out;
}

/** 端末で出さない操作（作者が「なぜ無いのか」を確かめられるように一覧にする） */
export function hiddenActions(tree: readonly ActionGroup[] = ACTION_TREE): { label: string; reason: string }[] {
  const out: { label: string; reason: string }[] = [];
  for (const group of tree) {
    for (const entry of group.entries) {
      const items = entry.kind === "section" ? entry.items : [entry];
      const section = entry.kind === "section" ? entry.label : undefined;
      for (const item of items) {
        if (item.hiddenFromActionList || item.browserOnly || item.supersededBy) continue;
        const reason = hiddenReason(item.label, group.label, section);
        if (reason) out.push({ label: item.label, reason });
      }
    }
  }
  return out;
}

/**
 * 検索欄で絞る。空白で区切った語が、名前・分類・小分類・説明の**どれかに全部**含まれる行。
 * 大文字小文字・全角半角の英数字は区別しない（打ちにくい画面で2〜3文字で絞れるように。4.4.1）
 */
export function searchActions(list: readonly ActionEntry[], query: string): ActionEntry[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...list];
  return list.filter((entry) => {
    const hay = fold([entry.label, entry.group, entry.section ?? "", entry.detail].join(" "));
    return words.every((word) => hay.includes(word));
  });
}

function fold(text: string): string {
  return text.normalize("NFKC").toLowerCase();
}
