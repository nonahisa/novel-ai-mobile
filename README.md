# 統合小説執筆環境 — スマホ・タブレット版（Android・iOS。同じリポジトリで作る）

パソコン版（`../novel-ai-assistant` のVSCode拡張機能）を Android と iOS へ移す作業場。iOS 版もこのリポジトリで作る（2026-11-02 作者「同じリポジトリで、iOS版まで開発します」）。Capacitor を使い、1つのプロジェクトから Android と iOS の両方を組み立てる。

- **元にしている統合の版：v1.0.37**（`package.json` の `novel-ai-assistant` の `#v1.0.37`。統合の版を上げるたびにこの行も直す。段取りは [`docs/引継ぎ書.md`](docs/引継ぎ書.md) 1・2章）
- このアプリの版：`package.json` の `version`（変えたことは [`CHANGELOG.md`](CHANGELOG.md)）

- GitHub：<https://github.com/nonahisa/novel-ai-mobile>（公開。拡張機能のリポジトリにならった）。2026-11-02 に `novel-ai-android` から改名した。古い URL は GitHub が新しい名前へ転送する。手元のフォルダー名は `novel-ai-android` のまま
- iOS の組み立て：**作者の手元の Mac の Xcode で組む**（2026-11-05 作者の答え。手順は [`docs/iOS組み立て手順.md`](docs/iOS組み立て手順.md)）。土台の `ios/` は生成済み（`@capacitor/ios` 8.6.2、Android と同じ版）
- ライセンス：MIT（`LICENSE`。拡張機能のコードを流用するので、著作権の行も拡張機能と同じにしている）
- CI：`main` への push と PR のたびに、Windows で `pnpm run apk`（型の検査 → ビルド → APK）を走らせる。macOS では `pnpm run sync:ios` を走らせる（`.github/workflows/ci.yml`）。タグ `v<版>` を押すと、配る APK と更新の札 `update.json` を GitHub Release に添える（`.github/workflows/release.yml`。配る鍵が Secrets に無い間は Release を作らない。鍵の作り方は [`docs/配る鍵の手順.md`](docs/配る鍵の手順.md)）

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
| 1 | `pnpm run dev` → <http://localhost:5173> | 画面と処理のほとんど。Claudeが自分で開いて確認できる |
| 2 | `pnpm run dev:lan` → 同じWi-Fiのスマホで `http://<パソコンのIP>:5173` | **ビルド不要**。日本語入力・縦書き・指の操作 |
| 3 | `pnpm run android`（実機をUSBで接続） | ファイル保存・Git・共有など、ネイティブが要る部分 |

段階2のURLは `pnpm run dev:lan` の出力の「Network:」に出る。ふだんの `pnpm run dev` はこのパソコンだけに開く（同じWi-Fiの機械から開発サーバーを突かれないように。2026-11-21）。

実機の WebView を覗いて調べる（chrome://inspect・adb の `webview_devtools_remote`）ときは、`NOVELAI_WEBVIEW_DEBUG=1` を付けて組む（`NOVELAI_WEBVIEW_DEBUG=1 pnpm run apk`）。付けなければ覗けない（`capacitor.config.ts`）。

---

## コマンド

パッケージ管理は pnpm（lock は `pnpm-lock.yaml`）。npm の lock は使わない。`.npmrc` の `node-linker=hoisted` は、Capacitor が生成する Gradle のパスを `node_modules/@capacitor/...` の形に保つためのもので、外さないこと。

```
pnpm run dev        開発サーバー（段階1・2）
pnpm run build      型検査とビルド
pnpm run typecheck  型検査だけ
pnpm run test       テスト（Vitest。パソコン版と同じ）
pnpm run sync       ビルドしてAndroidプロジェクトへ反映
pnpm run apk        APKを作る（android/app/build/outputs/apk/debug/）
pnpm run android    APKを作って実機で起動（段階3）
pnpm run devices    つながっている端末を見る
pnpm run sync:ios   ビルドしてiOSプロジェクト（ios/）へ反映（Macだけ）
pnpm run ios        iOSのシミュレーターで起動（Macだけ）
pnpm run ios:open   XcodeでiOSプロジェクトを開く（Macだけ）
```

### iOS（Mac）

- 必要なもの：**フル版の Xcode**（App Store から。Command Line Tools だけでは `xcodebuild` が動かない）
- 初回だけ、ターミナルで次を実行する（パスワードを聞かれる）：
  ```
  sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
  sudo xcodebuild -license accept
  sudo xcodebuild -runFirstLaunch
  ```
- `ios/` は `npx cap add ios` で生成済み。中身は Capacitor の土台で、手で書き換える場所ではない
- CI（`.github/workflows/ci.yml` の `ios` ジョブ）は macOS で `pnpm run sync:ios` まで走らせる。署名が要るので Xcode のビルドはまだ CI に入れていない
- 実機確認（縦書き入力・キーボード・safe-area）は [`docs/実機確認リスト.md`](docs/実機確認リスト.md) の iOS の節を見る

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

エミュレーターは `emulator -avd Hello_API36` で起こす。起きたら `pnpm run android` で実機と同じに入る。

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
5. `pnpm run devices` で出てくれば成功

---

## 移植の見積り（2026-08-31 時点の実測。移植を始める前の記録）

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

| # | 問題 | 対策（いま） |
|---|---|---|
| a | **縦書きtextareaに日本語変換で入力できるか**（Android WebViewでの実績が不明） | AQUOS・iPad の実機で、Gboard・iPad の日本語入力の変換と確定を確かめた（[`docs/実機確認リスト.md`](docs/実機確認リスト.md)） |
| b | Androidは好きなフォルダを自由に読み書きできない | アプリ専用領域（`Directory.Data`）に置き、**GitHub同期でパソコンと行き来する** |
| c | `git` コマンドがない | `isomorphic-git` で取得・送信・競合の扱いを作った |
| d | WebViewから直接AIを叩くとCORSで弾かれる | `CapacitorHttp` を使う（`ai/httpClient.ts` の差し替え）。クラウドの AI 4社（Anthropic・OpenAI・Gemini・さくら）につなぐ |
| e | Ollamaはスマホで動かない | いまはクラウドの AI だけ。手元の AI は Tailscale の道だけで呼ぶ予定（家の Wi-Fi で直に `http://` は作らない。2026-10-31 作者の裁定） |

---

## いまあるもの

`src/main.ts` が製品の入口で、画面の中身は `src/app/`、端末の口は `src/platform/` にある。下のタブは4つ（作品・書く・提案・ほか）。

- 作品一覧と話の一覧、縦書きの原稿エディター（横書きにも切り替えられる。キーボードの上の道具帯・下書きの控え）
- GitHub で作品フォルダーを同期する（取得・送信・競合を作者が選ぶ）。GitHub から作品を取り寄せる
- AI の機能：あらすじ・誤字脱字・校正・指摘の一覧と提案（クラウドの AI。料金がかかる呼び出しの前に確かめる）
- 執筆統計（今日・今週の字数と、直近14日の棒グラフ）、表示の設定、更新の確かめ、使っている部品のライセンス
- 動作確認ページ（縦書き入力・ルビと傍点・ファイルの往復を確かめる試しの画面）は［ほか］→ ヘルプに残してある

進み具合は [`docs/実装の残り.md`](docs/実装の残り.md)、実機で確かめたことは [`docs/実機確認リスト.md`](docs/実機確認リスト.md)、引継ぎは [`docs/引継ぎ書.md`](docs/引継ぎ書.md)。
