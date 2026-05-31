import SwiftUI
import WidgetKit

/// Mac Widget Extension のエントリ。`@main` を付けて
/// WidgetKit に解釈させる。
///
/// 配置: Notification Center / Today View / macOS Sonoma+ の Desktop。
/// データは App Group 共有コンテナの `widget-state.json` を 1 秒以下のレイテンシで読み込む。
@main
struct VigiliWidgetBundle: WidgetBundle {
  var body: some Widget {
    VigiliPendingWidget()
  }
}
