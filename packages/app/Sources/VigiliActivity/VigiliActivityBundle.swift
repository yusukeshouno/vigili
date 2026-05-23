import WidgetKit
import SwiftUI

/// Widget Extension のエントリ。Live Activity を 1 個だけ束ねる。
/// (ホーム画面ウィジェットなど他の widget は今のところ無し)
@main
struct VigiliActivityBundle: WidgetBundle {
  var body: some Widget {
    VigiliLiveActivity()
  }
}
