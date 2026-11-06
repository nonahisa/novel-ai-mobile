import { bytesToBase64 } from "./capacitorFileStore";

/**
 * **GitHub の API で版を作って送る**（原稿を持ち帰る道 A。`docs/原稿を持ち帰る道の比べ.md`。
 * 作者の決定 2026-11-07）。
 *
 * git の送信（push）は版の中身を2進で送るので、端末の通信の口（`CapacitorHttp`）では送れない
 * （`gitHttp.ts` の `GitBinaryBodyError`）。代わりに `api.github.com` の口で、版を1つずつ組み立てる。
 *
 * 1. 変わったファイルの中身を送る（`POST git/blobs`。base64 の JSON）
 * 2. 前の版の木に、変わった所だけを重ねた木を作る（`POST git/trees` の `base_tree`。消すのは `sha: null`）
 * 3. 版を作る（`POST git/commits`。親は前の版）
 * 4. 枝をその版へ進める（`PATCH git/refs/heads/<枝>`。**早送りだけ**。`force` は付けない）
 *
 * `api.github.com` は CORS を許す（`*`。2026-11-07 に Android・iOS の出どころで確かめた）ので、
 * WebView の `fetch` で送れる。送受信は引数で渡す（テストで偽の GitHub に替える）。
 *
 * ## 原稿を壊さないための確かめ
 *
 * - **送る前に、枝の今の版が前の版（`baseCommit`）と同じかを見る。** 違えば何も送らずに
 *   「向こうが進んでいる」（`behind`）を返す。受け取って見比べるのは呼び手（食い違いの扱い）
 * - **中身のハッシュを照らす。** git の中身の名前（SHA-1）は中身だけで決まるので、
 *   GitHub が返した名前が、手元で数えた名前と違えば止める（文字の形が途中で変わった印）
 * - **木のハッシュを照らす。** 呼び手が手元の git で数えた木（`expectedTree`）を渡せば、
 *   GitHub で組んだ木がそれと違うとき、版を作らずに止める。手元と向こうで中身が1字でも違えば
 *   木の名前が変わるので、「送ったつもりの原稿と、向こうに残った原稿が違う」を防ぐ
 * - 枝を進める口が「早送りでない」と断ったら（422）、`behind` を返す。版と木は向こうに残るが、
 *   どの枝からも指されないので害はない（見立て：GitHub がいずれ片づける）
 * - **黙って送り直さない。** 失敗は種類だけを返す（AI の通信と同じ規則5。エラー文から原因を当てない）
 *
 * 版の名前（SHA）は手元の git の版と同じになるとは限らない（GitHub が時刻や署名を付けうる。見立て）。
 * 送ったあと、呼び手は取得（fetch）して手元の枝をこの版に合わせる。木が同じなので作業の木は変わらない。
 *
 * 見立て（公式の頁で確かめる。`docs/原稿を持ち帰る道の比べ.md` 4章）：1つの中身の大きさの上限・
 * 早送りでないときの状態の番号が 422 であること。
 */

export const GITHUB_API = "https://api.github.com";

/** `fetch` の応答のうち、ここで使う所だけ */
export interface ApiResponse {
  status: number;
  json(): Promise<unknown>;
}
/** `fetch` に似た送受信。本物の `fetch` をそのまま渡せる */
export type ApiFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string }
) => Promise<ApiResponse>;

export interface RepoRef {
  owner: string;
  repo: string;
  branch: string;
}

/** 変わったファイル。道は作品の根からの `/` 区切り */
export type FileChange =
  | { path: string; bytes: Uint8Array; /** 手元の git で数えた中身の名前（`git.hashBlob`） */ oid?: string }
  | { path: string; deleted: true };

export interface CommitIdentity {
  name: string;
  email: string;
  /** ISO 8601（省けば GitHub が今の時刻を付ける） */
  date?: string;
}

export interface PushInput extends RepoRef {
  token: string;
  /** 手元が最後に向こうとそろえた版（この上に積む） */
  baseCommit: string;
  /** その版の木（分かっていれば。省けば GitHub に訊く） */
  baseTree?: string;
  changes: readonly FileChange[];
  message: string;
  author: CommitIdentity;
  /** 手元の git で数えた、送ったあとの木。渡せば照らす */
  expectedTree?: string;
}

export type ApiFailureKind =
  /** つながらない（fetch が例外を投げた） */
  | "offline"
  /** サインインし直す（401） */
  | "sign_in_again"
  /** 権限が無い・リポジトリが無い（403・404。GitHub は権限が無いときも 404 を返す） */
  | "no_access"
  /** 上限に当たった（429、または 403 で残りが0） */
  | "rate_limited"
  /** GitHub の側の不具合（5xx） */
  | "server"
  /** 中身・木の名前が手元と違った。送った原稿の形が変わった */
  | "hash_mismatch"
  /** 道が作品の外を指す・空など、送れない変更 */
  | "bad_change"
  /** そのほか（決めつけない） */
  | "unknown";

export interface ApiFailure {
  kind: ApiFailureKind;
  /** どの段で止まったか（ログ用。作者には `nextAction` を出す） */
  step: "ref" | "base" | "blob" | "tree" | "commit" | "update_ref" | "check";
  status?: number;
  path?: string;
}

export type PushResult =
  | { kind: "pushed"; commit: string; tree: string }
  /** 変更が無い。何も送っていない */
  | { kind: "nothing_to_push" }
  /** 向こうの枝が先へ進んでいる。受け取って見比べてから送り直す */
  | { kind: "behind"; remoteHead?: string }
  | { kind: "failed"; error: ApiFailure };

/** 種類ごとの次の操作（作者へ出す1つ） */
export function nextAction(kind: ApiFailureKind): string {
  switch (kind) {
    case "offline":
      return "ネットにつながってから、もう一度［保存・同期］を押してください。";
    case "sign_in_again":
      return "GitHub にサインインし直してください。";
    case "no_access":
      return "この作品のリポジトリに書き込めません。リポジトリの名前と、サインインした GitHub のアカウントを確かめてください。";
    case "rate_limited":
      return "GitHub の回数の上限に当たりました。しばらく待ってから、もう一度押してください。";
    case "server":
      return "GitHub の側で不具合が起きています。しばらく待ってから、もう一度押してください。";
    case "hash_mismatch":
      return "送った原稿と、GitHub に届いた原稿が一致しませんでした。送るのを止めました。原稿はこの端末に残っています。";
    case "bad_change":
      return "送れない名前のファイルがあります。送るのを止めました。";
    default:
      return "送れませんでした。もう一度押しても同じなら、作者のパソコンで確かめてください。";
  }
}

/** 作品の外を指す道・空の道は送らない */
export function isSafeRepoPath(path: string): boolean {
  if (path.length === 0 || path.startsWith("/") || path.endsWith("/") || path.includes("\\")) return false;
  return path.split("/").every((part) => part.length > 0 && part !== "." && part !== "..");
}

const SHA = /^[0-9a-f]{40}$/;

class Api {
  constructor(
    private readonly fetcher: ApiFetch,
    private readonly token: string,
    private readonly base: string
  ) {}

  async call(
    step: ApiFailure["step"],
    method: string,
    path: string,
    body?: unknown
  ): Promise<{ ok: true; status: number; data: unknown } | { ok: false; error: ApiFailure }> {
    let response: ApiResponse;
    try {
      response = await this.fetcher(`${this.base}${path}`, {
        method,
        headers: {
          accept: "application/vnd.github+json",
          authorization: `Bearer ${this.token}`,
          "x-github-api-version": "2022-11-28",
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      return { ok: false, error: { kind: "offline", step } };
    }
    const status = response.status;
    let data: unknown;
    try {
      data = await response.json();
    } catch {
      data = undefined;
    }
    if (status >= 200 && status < 300) return { ok: true, status, data };
    return { ok: false, error: { kind: classify(status, data), step, status } };
  }
}

/** 状態の番号だけで分ける（文は見ない）。403 は残りの回数が0と読めるときだけ上限 */
function classify(status: number, _data: unknown): ApiFailureKind {
  if (status === 401) return "sign_in_again";
  if (status === 429) return "rate_limited";
  if (status === 403 || status === 404) return "no_access";
  if (status >= 500) return "server";
  return "unknown";
}

function shaOf(data: unknown, ...keys: string[]): string | undefined {
  let value: unknown = data;
  for (const key of keys) value = (value as Record<string, unknown> | undefined)?.[key];
  return typeof value === "string" && SHA.test(value) ? value : undefined;
}

const enc = (part: string) => encodeURIComponent(part);

/** 変わったファイルを1つの版にして、枝を早送りで進める */
export async function pushViaGitHubApi(
  input: PushInput,
  fetcher: ApiFetch = (url, init) => globalThis.fetch(url, init),
  base = GITHUB_API
): Promise<PushResult> {
  if (input.changes.length === 0) return { kind: "nothing_to_push" };
  const seen = new Set<string>();
  for (const change of input.changes) {
    if (!isSafeRepoPath(change.path) || seen.has(change.path)) {
      return { kind: "failed", error: { kind: "bad_change", step: "check", path: change.path } };
    }
    seen.add(change.path);
  }

  const api = new Api(fetcher, input.token, base);
  const repo = `/repos/${enc(input.owner)}/${enc(input.repo)}`;
  const refPath = `${repo}/git/refs/heads/${input.branch.split("/").map(enc).join("/")}`;

  // 1. 向こうの枝が、手元の知っている版のままか
  const ref = await api.call("ref", "GET", `${repo}/git/ref/heads/${input.branch.split("/").map(enc).join("/")}`);
  if (!ref.ok) return { kind: "failed", error: ref.error };
  const remoteHead = shaOf(ref.data, "object", "sha");
  if (!remoteHead) return { kind: "failed", error: { kind: "unknown", step: "ref" } };
  if (remoteHead !== input.baseCommit) return { kind: "behind", remoteHead };

  // 2. 前の版の木
  let baseTree = input.baseTree;
  if (!baseTree) {
    const commit = await api.call("base", "GET", `${repo}/git/commits/${input.baseCommit}`);
    if (!commit.ok) return { kind: "failed", error: commit.error };
    baseTree = shaOf(commit.data, "tree", "sha");
    if (!baseTree) return { kind: "failed", error: { kind: "unknown", step: "base" } };
  }

  // 3. 中身を送る（名前を手元と照らす）
  const entries: { path: string; mode: "100644"; type: "blob"; sha: string | null }[] = [];
  for (const change of input.changes) {
    if ("deleted" in change) {
      entries.push({ path: change.path, mode: "100644", type: "blob", sha: null });
      continue;
    }
    const blob = await api.call("blob", "POST", `${repo}/git/blobs`, {
      content: bytesToBase64(change.bytes),
      encoding: "base64",
    });
    if (!blob.ok) return { kind: "failed", error: { ...blob.error, path: change.path } };
    const sha = shaOf(blob.data, "sha");
    if (!sha) return { kind: "failed", error: { kind: "unknown", step: "blob", path: change.path } };
    if (change.oid && change.oid !== sha) {
      return { kind: "failed", error: { kind: "hash_mismatch", step: "blob", path: change.path } };
    }
    entries.push({ path: change.path, mode: "100644", type: "blob", sha });
  }

  // 4. 木を組む（照らす）
  const tree = await api.call("tree", "POST", `${repo}/git/trees`, { base_tree: baseTree, tree: entries });
  if (!tree.ok) return { kind: "failed", error: tree.error };
  const treeSha = shaOf(tree.data, "sha");
  if (!treeSha) return { kind: "failed", error: { kind: "unknown", step: "tree" } };
  if (input.expectedTree && input.expectedTree !== treeSha) {
    return { kind: "failed", error: { kind: "hash_mismatch", step: "tree" } };
  }
  if (treeSha === baseTree) return { kind: "nothing_to_push" };

  // 5. 版を作る
  const author = { name: input.author.name, email: input.author.email, ...(input.author.date ? { date: input.author.date } : {}) };
  const commit = await api.call("commit", "POST", `${repo}/git/commits`, {
    message: input.message,
    tree: treeSha,
    parents: [input.baseCommit],
    author,
  });
  if (!commit.ok) return { kind: "failed", error: commit.error };
  const commitSha = shaOf(commit.data, "sha");
  if (!commitSha) return { kind: "failed", error: { kind: "unknown", step: "commit" } };

  // 6. 枝を早送りで進める（force は付けない）
  const update = await api.call("update_ref", "PATCH", refPath, { sha: commitSha, force: false });
  if (!update.ok) {
    if (update.error.status === 422) return { kind: "behind" };
    return { kind: "failed", error: update.error };
  }
  return { kind: "pushed", commit: commitSha, tree: treeSha };
}
