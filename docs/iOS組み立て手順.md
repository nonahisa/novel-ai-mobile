# iOS の組み立て手順（Mac 側のセッションへ渡す）

モバイル版（このリポジトリ）を、作者の Mac で iOS のシミュレーターに出すまでの手順（2026-11-06 作成）。
**受け持ち**：組み立ての中身と手順はモバイル版の担当が書く。Mac の上で手を動かすのは Mac 側のセッション（「MAC実機確認」）で、作者の了解を取ってから入れる。作者を通して、この文書を Mac 側へ渡す。

## 作者の Mac（2026-11-06、Mac 側の調べ）

- Apple M1、メモリ 8GB、macOS 27.2、空き 290GB
- ほぼ初期状態。Xcode・Homebrew・Node・git（Command Line Tools）は入っていない

メモリ 8GB は、Xcode とシミュレーターを同時に動かすと重いが、組み立てには足りる。ほかのアプリは閉じておく。

## 1. 入れるもの（どれも作者の了解を取ってから）

| もの | 入れ方 | 確かめ方 |
| --- | --- | --- |
| Xcode | App Store で「Xcode」を探して入れる（数十 GB。時間がかかる）。入れたら一度開き、使用許諾に同意し、出てきた選択で **iOS** の部品（シミュレーター）も入れる | `xcodebuild -version` |
| Command Line Tools | Xcode を開いたあと、ターミナルで `sudo xcode-select -s /Applications/Xcode.app/Contents/Developer`。git もここに入る | `git --version` |
| Node 22 | nodejs.org の「LTS」の macOS 用の入れ物（.pkg）。CI と同じ 22 系にする（`.github/workflows/ci.yml`） | `node -v` が v22 |
| pnpm 10.34.9 | `npm install -g pnpm@10.34.9`（`package.json` の `packageManager` と同じ版。**npm で `node_modules` を入れ直さない**） | `pnpm -v` |

Homebrew は要らない。CocoaPods も要らない（`ios/App/CapApp-SPM`：Swift Package Manager の作り）。

## 2. 取ってきて、組み立てる

```bash
git clone https://github.com/nonahisa/novel-ai-mobile.git
cd novel-ai-mobile
pnpm install --frozen-lockfile
pnpm run test
pnpm run ios:open
```

- `pnpm install` は統合小説執筆環境（本体）のタグ（`package.json` の `novel-ai-assistant`）も GitHub から取ってくる。git が要る
- `pnpm run ios:open` は、組み立て（`vite build`）→ `ios/` へ写す（`cap sync ios`）→ Xcode で `ios/App/App.xcodeproj` を開く
- Xcode の上の帯の真ん中で、行き先を「iPhone 17」などのシミュレーターに選び、左上の ▶（Run）を押す。初回は署名を訊かれることがある：左の列の「App」→「Signing & Capabilities」→「Team」で作者の Apple ID（「Add an Account…」）を選ぶ。シミュレーターだけなら無料の Apple ID で足りる
- ターミナルから直に出すなら `pnpm run ios`（シミュレーターを選ぶ問いが出る）

**枝**：まずは `main` で組み立てる。新しい部品（AI への通信・git の取得・中止で切る道）は PR #5〜#7 の枝にあり、まだ main に入っていない。確かめたい枝があるときは、モバイル版の担当がこの文書に書き足す。

## 3. 出たら確かめること（Mac 側から、作者を通してモバイル版へ返す）

アプリが開くと「動作確認ページ」が出る。上から順にボタンを押し、出た文を写して返す。

1. 「1. いま動いている場所」の行（`ios` と出るか、本体の部品の版）
2. 2〜4 のボタン（端末へのファイルの読み書き、本文の書き戻し）
3. 5〜7 は、PR の枝で組み立てたときだけ（main には無い）

うまく行かないときは、Xcode の下の欄（記録）の赤い行と、ターミナルの最後の20行を写して返す。

## 4. まだ決めていないこと

- 実機の iPhone へ入れるか（Apple の開発者登録。年 99 ドル。無料の Apple ID でも7日だけ入れられる）。作者に訊く
- iOS の CI で Xcode の組み立てまでするか（いまは `cap sync ios` まで。`.github/workflows/ci.yml`）
