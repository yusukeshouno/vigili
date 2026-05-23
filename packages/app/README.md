# Sentinel.app

メニューバー常駐の Mac ネイティブアプリ。SwiftUI + AppKit、macOS 13+。

iPhone PWA / Tailscale serve / Web Push の経路はそのままに、Mac 側だけ
「メニューバーから ask カードを直接承認できる」体験を足す。

## 構成

```
packages/app/
├── project.yml                 # xcodegen 設定 (Xcode プロジェクトの SoT)
├── Sources/Sentinel/           # Swift ソース
│   ├── SentinelApp.swift       # @main エントリ (MenuBarExtra)
│   ├── AppDelegate.swift       # ライフサイクル + 終了時の SIGTERM
│   ├── AppCoordinator.swift    # 状態集約 ObservableObject
│   ├── DaemonController.swift  # daemon を子プロセスとして spawn + 監視
│   ├── DaemonLogBuffer.swift   # 直近 1000 行のリングバッファ
│   ├── LaunchdMigrator.swift   # 旧 launchd plist を bootout
│   └── PopoverContentView.swift # SwiftUI ポップオーバー
├── Resources/
│   ├── Info.plist              # LSUIElement=true、ATS localhost 許可
│   └── Sentinel.entitlements   # sandbox off
└── Assets.xcassets/
    └── AppIcon.appiconset/     # (12-D で 4 弁花アイコンを差し込む)
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
open Sentinel.xcodeproj
```

Xcode で `⌘R` でビルド + 起動。メニューバーに盾アイコンが出れば成功。

### 注意: 重複起動を避ける

`xcodegen` で生成された Sentinel.app をビルド起動すると、
**既存の launchd 管理 daemon (`io.sentinel.daemon`) を自動で bootout します**
(`LaunchdMigrator.boototIfLoaded()`)。

アプリを quit すると daemon も止まります (SIGTERM)。
Phase 11 の launchd 管理に戻したい場合は手動で:

```bash
launchctl bootstrap gui/$UID ~/Library/LaunchAgents/io.sentinel.daemon.plist
```

PWA (`io.sentinel.pwa`) は 12-A 時点では触りません。引き続き launchd 管理。
12-D で同じく アプリ管理 に移行予定。

## デバッグ

- daemon の標準出力/標準エラーは `~/.sentinel/daemon.log` に追記される
- アプリ自身のログは `Console.app` で `process:Sentinel` 等でフィルタ
- popover の "Restart daemon" ボタンで子プロセスを再起動できる
- popover の "Logs" アイコンで `~/.sentinel/daemon.log` を Finder/Console.app で開く

## 制限事項 (Phase 12-A 時点)

- ask カードはまだ出ない (Phase 12-C で実装)
- pending 数のバッジは固定 0 (Phase 12-B で daemon admin protocol 経由で更新)
- PWA を WKWebView で開く機能は未実装 (Phase 12-D)
- 初回起動ウィザード未実装 (Phase 12-E)
- 配布用 .dmg なし (Phase 12-F)
- daemon の cli.js パスは `~/Dropbox (個人)/sentinel/packages/daemon/dist/cli.js` ハードコード
  - 別のリポジトリ位置で動かす場合は UserDefaults で上書き:
    ```bash
    defaults write io.sentinel.app sentinel.daemonCliJs "/path/to/your/cli.js"
    ```
