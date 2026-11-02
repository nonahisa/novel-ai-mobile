# 統合小説執筆環境 — スマホ・タブレット版（Android を移植中。iOS も同じリポジトリで作る）

パソコン版（`../novel-ai-assistant` のVSCode拡張機能）を Android と iOS へ移す作業場。iOS 版もこのリポジトリで作る（2026-11-02 作者「同じリポジトリで、iOS版まで開発します」）。Capacitor を使い、1つのプロジェクトから Android と iOS の両方を組み立てる。

- GitHub：<https://github.com/nonahisa/novel-ai-mobile>（公開。拡張機能のリポジトリにならった）。2026-11-02 に `novel-ai-android` から改名した。古い URL は GitHub が新しい名前へ転送する。手元のフォルダー名は `novel-ai-android` のまま
- iOS の組み立て：Mac（Xcode）か、GitHub Actions の macOS の機械が要る。**どちらにするかは作者がまだ決めていない**（詳細設計書 11章・12章）
- ライセンス：MIT（`LICENSE`。拡張機能のコードを流用するので、著作権の行も拡張機能と同じにしている）
- CI：`main` への push と PR のたびに、Windows で `npm run apk`（型の検査 → ビルド → APK）を走らせる（`.github/workflows/ci.yml`）

---

## なぜ Capacitor（WebView方式）か

パソコン版の原稿エディタは、縦書きを **CSS の `writing-mode: vertical-rl` 1行**で実現している。

- **React Native / Flutter** には `writing-mode` に相当する機能がない。縦書き・ルビ・傍点を全部自前で描くことになる
- **Capacitor** は中身がWebView（ブラウザ）なので、いまのHTML/CSSがそのまま動く。パネル類（設定資料・執筆統計・提案・編集履歴）も流用できる

加えて、**パソコンのブラウザで開発できる**ので、確認の往復がAPKを作り直すより桁違いに速い。

---

## 確かめ方は3段階

| 段階 | やり方 | 何を見るか |
|---|---|---|
| 1 | `npm run dev` → <http://localhost:5173> | 画面と処理のほとんど。Claudeが自分で開いて確認できる |
| 2 | 同じWi-Fiのスマホで `http://<パソコンのIP>:5173` | **ビルド不要**。日本語入力・縦書き・指の操作 |
| 3 | `npm run android`（実機をUSBで接続） | ファイル保存・Git・共有など、ネイティブが要る部分 |

段階2のURLは `npm run dev` の出力の「Network:」に出る。`vite.config.ts` の `host: true` がこれを支えているので、外さないこと。

---

## コマンド

```
npm run dev        開発サーバー（段階1・2）
npm run build      型検査とビルド
npm run typecheck  型検査だけ
npm run test       テスト（Vitest。パソコン版と同じ）
npm run sync       ビルドしてAndroidプロジェクトへ反映
npm run apk        APKを作る（android/app/build/outputs/apk/debug/）
npm run android    APKを作って実機で起動（段階3）
npm run devices    つながっている端末を見る
```

---

## 環境（2026-08-31 時点で構築済み）

| 項目 | 版・場所 |
|---|---|
| Android Studio | 2026.1.3 |
| Android SDK | `%LOCALAPPDATA%\Android\Sdk`（platform 36 / 37、build-tools 36） |
| **JDK** | **Temurin 21**（`C:\Program Files\Eclipse Adoptium\jdk-21.0.12.101-hotspot`） |
| Gradle | 8.14.3（wrapper） |
| AGP | 8.13.0 |
| minSdk / targetSdk | 24（Android 7.0）／ 36 |
| Command-line Tools | 23.0（`%LOCALAPPDATA%\Android\Sdk\cmdline-tools\latest`。`sdkmanager` は Android CLI `android.exe` に変わった）。2026-10-29 追加 |
| エミュレーター | 37.1.11、端末 `Hello_API36`（Android 16 / API 36、Google APIs、x86_64、WHPX で加速）。2026-10-29 追加 |

エミュレーターは `emulator -avd Hello_API36` で起こす。起きたら `npm run android` で実機と同じに入る。

PowerShell から `sdkmanager.bat` / `avdmanager.bat` へ `system-images;android-36;...` を渡すと、
cmd が `;` で割って失敗する。`android.exe sdk install system-images/android-36/google_apis/x86_64`（`/` 区切り）を使う。

### JDK 25 では動かない（重要）

Android Studio に同梱されているJDKは **25** で、これを `JAVA_HOME` にすると Gradle 8.14 が
`Unsupported class file major version 69` で落ちる。Gradle 8.14 の対応は JDK 24 まで。

**そのため `JAVA_HOME` は Temurin 21 を指している。** Android Studio を更新しても、
ここを同梱JDKへ戻さないこと。

### adb のファイアウォール

`adb` の起動時にWindowsがネットワーク許可を聞いてくるが、**USB接続なら許可は不要**
（自分のパソコンの中だけで通信する）。Wi-Fi経由のワイヤレスデバッグを使うときだけ許可する。

---

## 実機をつなぐ

1. スマホの「設定 → デバイス情報 → ビルド番号」を7回タップして開発者オプションを出す
2. 「設定 → システム → 開発者向けオプション → USBデバッグ」をON
3. USBケーブルでパソコンにつなぐ（充電専用ケーブルでは映らない）
4. スマホに出る「USBデバッグを許可しますか」で許可
5. `npm run devices` で出てくれば成功

---

## 移植の見積り（実測）

パソコン版のソースを解析した結果。

| 状態 | 行数 |
|---|---:|
| そのまま持っていける（`models` / `core` / `ai` / `prompts`） | 22,715 |
| `paths.ts` `textFile.ts` の2つ（686行）を差し替えると | **35,743** |
| さらに `device.ts` `git.ts` ほか5つ（計8つ・2,776行）まで直すと | **37,839** |

**少数の土台ファイルを書き直すだけで、大半のコードが動く。** これは
パソコン版が「`core` は VS Code に依存させない」という方針を守ってきた結果である。

作り直しが要るのは `features`（35,760行）と `views` のツリー表示。ただし
`views` のWebViewパネル（設定資料・執筆統計・提案・編集履歴）はHTML/CSSなので流用できる。

`移植できるファイル一覧.txt` に、そのまま持っていけるファイルの一覧がある。

### 先に潰すべき問題

| # | 問題 | 対策 |
|---|---|---|
| a | **縦書きtextareaに日本語変換で入力できるか**（Android WebViewでの実績が不明） | **最優先で実機確認**。動作確認ページで試せる |
| b | Androidは好きなフォルダを自由に読み書きできない | アプリ専用領域（`Directory.Data`）に置き、**GitHub同期でパソコンと行き来する** |
| c | `git` コマンドがない | `isomorphic-git`（導入済み）に差し替え |
| d | WebViewから直接AIを叩くとCORSで弾かれる | `CapacitorHttp` を使う。`ai/httpClient.ts` の差し替えで済む |
| e | Ollamaはスマホで動かない | パソコンのOllamaをLAN越しに叩くか、クラウドAIのみ |

---

## いまあるもの

`src/main.ts` は**動作確認ページ**であって、製品の画面ではない。
移植で最初に壊れそうな3点（縦書き入力・ルビと傍点・ファイルの往復）を、
3段階のどこからでも同じ画面で確かめられるようにしてある。
