# Vigili.app

メニューバー常駐の Mac ネイティブアプリ。SwiftUI + AppKit、macOS 13+。

iPhone PWA / Tailscale serve / Web Push の経路はそのままに、Mac 側だけ
「メニューバーから ask カードを直接承認できる」体験を足す。

## 構成

```
packages/app/
├── project.yml                 # xcodegen 設定 (Xcode プロジェクトの SoT)
├── Sources/Vigili/             # Mac app Swift ソース
│   ├── SentinelApp.swift       # @main エントリ (MenuBarExtra)
│   ├── AppDelegate.swift       # ライフサイクル + 終了時の SIGTERM
│   ├── AppCoordinator.swift    # 状態集約 ObservableObject
│   ├── DaemonController.swift  # daemon を子プロセスとして spawn + 監視
│   ├── DaemonLogBuffer.swift   # 直近 1000 行のリングバッファ
│   ├── LaunchdMigrator.swift   # 旧 launchd plist を bootout
│   ├── PopoverContentView.swift # SwiftUI ポップオーバー
│   └── MessageComposerView.swift # 人間 → Claude composer
├── Sources/VigiliMobile/       # iPhone app
├── Sources/VigiliActivity/     # iOS Live Activity extension
├── Sources/VigiliWidget/       # Mac Widget extension
├── Sources/Shared/             # cross-platform 共通モデル
├── Sources/SharedMobile/       # iOS / Live Activity 共通
├── Resources/
│   ├── Info.plist              # LSUIElement=true、ATS localhost 許可
│   └── Vigili.entitlements     # sandbox off
└── Assets.xcassets/
    ├── MacAppIcon.appiconset/  # Mac の Dock / Finder
    ├── AppIcon.appiconset/     # iOS App Store / Home screen
    └── MenuBarIcon.imageset/   # メニューバーのテンプレート
```

## ビルド手順

### 前提条件

```bash
# 1. Xcode (フル版、~15GB)
open "macappstore://apps.apple.com/app/xcode/id497799835"
# インストール後、一度起動してライセンスに同意

# 2. xcodegen
brew install xcodegen
```

### Xcode プロジェクトを生成

```bash
cd packages/app
xcodegen
open Vigili.xcodeproj
```

Xcode で `⌘R` でビルド + 起動。メニューバーに 4 弁花アイコンが出れば成功。

### 注意: 重複起動を避ける

`xcodegen` で生成された Vigili.app をビルド起動すると、
**既存の launchd 管理 daemon (`io.vigili.daemon`) を自動で bootout します**
(`LaunchdMigrator.boototIfLoaded()` は io.sentinel.daemon と io.vigili.daemon の
両方を見る予定)。

アプリを quit すると daemon も止まります (SIGTERM)。
launchd 管理に戻したい場合は手動で:

```bash
launchctl bootstrap gui/$UID ~/Library/LaunchAgents/io.vigili.daemon.plist
```

## デバッグ

- daemon の標準出力/標準エラーは `~/.vigili/daemon.log` に追記される
- アプリ自身のログは `Console.app` で `process:Vigili` 等でフィルタ
- popover の "Restart daemon" ボタンで子プロセスを再起動できる
- popover の "Logs" アイコンで `~/.vigili/daemon.log` を Finder/Console.app で開く

## 注意: bundle ID 移行

R-4 で bundle ID を一括 rename:

| 旧 | 新 |
|---|---|
| `io.sentinel.app` | `io.vigili.app` (Mac) |
| `io.sentinel.mobile` | `io.vigili.mobile` (iPhone) |
| `io.sentinel.mobile.activity` | `io.vigili.mobile.activity` (Live Activity) |
| `io.sentinel.app.widget` | `io.vigili.app.widget` (Mac Widget) |

新規 provisioning profile の発行と、既存 install の置換が必要 (新 ID で初回起動)。
UserDefaults キー (例: `defaults write io.vigili.app sentinel.daemonCliJs "/path/to/cli.js"`)
は新 ID 配下に作り直すこと。

URL scheme: `sentinel://setup?u=...&t=...` と `vigili://setup?u=...&t=...` の
両方を受け入れる (移行期)。
