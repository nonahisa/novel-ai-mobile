import "./style.css";
import { Capacitor } from "@capacitor/core";
import { Directory, Encoding, Filesystem } from "@capacitor/filesystem";

/**
 * Android版の動作確認ページ。
 *
 * **これは製品の画面ではない。** 移植で最初に壊れそうな3点を、
 * 実機で一度に確かめるための足場である。
 *
 *   1. 縦書きの原稿欄に、日本語変換で入力できるか
 *      （パソコン版の原稿エディタは `writing-mode: vertical-rl` の textarea
 *        で縦書きにしている。Android の WebView で同じ手が使えるかは未知数で、
 *        ここが駄目なら設計が変わる）
 *   2. ルビと傍点が縦書きで正しい向きに出るか
 *   3. ファイルの書き込みと読み戻しができるか（原稿を失わないための最低条件）
 *
 * パソコンのブラウザ・スマホのブラウザ・APK の3通りで同じ画面が開くので、
 * どこから壊れるのかを切り分けられる。
 */

const app = document.querySelector<HTMLDivElement>("#app")!;

app.innerHTML = `
  <h1>動作確認（Android / iOS）</h1>

  <section class="card">
    <h2>1. いま動いている場所</h2>
    <dl id="env"></dl>
  </section>

  <section class="card">
    <h2>2. 縦書きの原稿欄</h2>
    <p class="note">
      ここに日本語で書いてみてください。変換候補が出るか、カーソルが縦に動くか、
      改行が右から左へ流れるかを見ます。
    </p>
    <textarea id="tategaki" rows="6">吾輩は猫である。名前はまだ無い。
どこで生れたか頓と見当がつかぬ。</textarea>
    <p class="count" id="count"></p>
  </section>

  <section class="card">
    <h2>3. ルビと傍点</h2>
    <p class="note">
      パソコン版と同じ書き方（<code>{漢字|かんじ}</code> と <code>{{強調}}</code>）が、
      縦書きで正しい向きに出るかを見ます。
    </p>
    <textarea id="rubySrc" rows="3">{吾輩|わがはい}は{{猫}}である。{名前|なまえ}はまだ無い。</textarea>
    <div id="rubyOut" class="tategaki-view"></div>
  </section>

  <section class="card">
    <h2>4. ファイルの書き込みと読み戻し</h2>
    <p class="note">
      2の原稿欄の中身を保存して、読み直します。<strong>ここが通らなければ、
      原稿を預けてはいけません。</strong>
    </p>
    <button id="save">保存して読み戻す</button>
    <pre id="fileResult" class="result">まだ試していません</pre>
  </section>
`;

/* ---------- 1. 環境の表示 ---------- */

const envEl = document.querySelector("#env")!;
const platformName = (p: string): string => ({ android: "Android", ios: "iOS" })[p] ?? "ブラウザ";
const renderEnv = () => {
  const platform = Capacitor.getPlatform();
  const viewport = window.visualViewport;
  const rows: [string, string][] = [
    ["土台", platform],
    ["ネイティブか", Capacitor.isNativePlatform() ? `はい（${platformName(platform)}）` : "いいえ（ブラウザ）"],
    ["画面の大きさ", `${window.innerWidth} × ${window.innerHeight}`],
    ["見えている高さ", viewport ? `${Math.round(viewport.height)}` : "取得できない"],
    ["画面の細かさ", String(window.devicePixelRatio)],
    ["縦書きに対応", CSS.supports("writing-mode", "vertical-rl") ? "はい" : "いいえ"],
    ["傍点に対応", CSS.supports("text-emphasis", "filled dot") ? "はい" : "いいえ"],
    ["ブラウザ", navigator.userAgent],
  ];
  envEl.innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${escapeHtml(v)}</dd>`).join("");
};
renderEnv();
/**
 * 画面の向きが変わったときと、**キーボードが出入りしたとき**に測り直す。
 * Androidでは日本語入力のキーボードが画面の半分近くを覆うので、
 * 縦書きの原稿欄がどれだけ潰れるかは、この数字を見ないと分からない。
 */
window.addEventListener("resize", renderEnv);
/**
 * iOS の WKWebView は、ソフトキーボードが出ても window の resize を送らないことがある。
 * 見えている範囲（visualViewport）の変化も拾わないと、キーボードで原稿欄が隠れたかが分からない。
 */
window.visualViewport?.addEventListener("resize", renderEnv);
window.visualViewport?.addEventListener("scroll", renderEnv);

/* ---------- 2. 文字数 ---------- */

const tategaki = document.querySelector<HTMLTextAreaElement>("#tategaki")!;
const count = document.querySelector<HTMLParagraphElement>("#count")!;
const updateCount = () => {
  // パソコン版と同じ数え方（改行を除く）にそろえる
  count.textContent = `${tategaki.value.replace(/\r?\n/g, "").length} 字`;
};
tategaki.addEventListener("input", updateCount);
updateCount();

/* ---------- 3. ルビと傍点 ---------- */

/**
 * 確認用の簡易版。**製品では `src/core/ruby.ts` を持ってくる。**
 * ここで本物を使わないのは、まだ共有コードの置き場所を決めていないため。
 */
function renderRuby(src: string): string {
  return escapeHtml(src)
    .replace(/\{\{(.+?)\}\}/g, '<em class="bouten">$1</em>')
    .replace(/\{(.+?)\|(.+?)\}/g, "<ruby>$1<rt>$2</rt></ruby>")
    .replace(/\r?\n/g, "<br>");
}

const rubySrc = document.querySelector<HTMLTextAreaElement>("#rubySrc")!;
const rubyOut = document.querySelector<HTMLDivElement>("#rubyOut")!;
const updateRuby = () => {
  rubyOut.innerHTML = renderRuby(rubySrc.value);
};
rubySrc.addEventListener("input", updateRuby);
updateRuby();

/* ---------- 4. ファイルの往復 ---------- */

const fileResult = document.querySelector<HTMLPreElement>("#fileResult")!;
document.querySelector<HTMLButtonElement>("#save")!.addEventListener("click", async () => {
  const path = "確認/原稿.txt";
  fileResult.textContent = "試しています…";
  try {
    await Filesystem.mkdir({ path: "確認", directory: Directory.Data, recursive: true }).catch(() => {
      // すでにあるときは失敗するが、それでよい
    });
    await Filesystem.writeFile({
      path,
      directory: Directory.Data,
      data: tategaki.value,
      encoding: Encoding.UTF8,
    });
    const back = await Filesystem.readFile({ path, directory: Directory.Data, encoding: Encoding.UTF8 });
    const uri = await Filesystem.getUri({ path, directory: Directory.Data });
    const same = back.data === tategaki.value;
    fileResult.textContent = [
      same ? "✅ 書いた内容と読み戻した内容が一致しました" : "❌ 内容が変わってしまいました",
      `置き場所: ${uri.uri}`,
      `読み戻した字数: ${String(back.data).length}`,
    ].join("\n");
  } catch (e) {
    fileResult.textContent = `❌ 失敗しました\n${e instanceof Error ? e.message : String(e)}`;
  }
});

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}
