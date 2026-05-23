import ActivityKit
import Foundation

/// Live Activity の「変わらない情報 (Attributes)」と「動的状態 (ContentState)」。
///
/// メイン iOS アプリと Widget Extension の両方が参照するので
/// 共有ターゲット (SharedMobile) に置く。
///
/// ContentState は最小限に: pending 数と、最も新しい 1 件のサマリーだけ。
/// Activity の最大 payload サイズが 4KB のため、フィールドはケチる。
public struct SentinelActivityAttributes: ActivityAttributes {
  public typealias ContentState = State

  public struct State: Codable, Hashable {
    /// 現在の pending 数。0 になったら end する。
    public var pendingCount: Int
    /// 一番新しい (= 上に表示する) request のサマリー。pending=0 のとき nil。
    public var top: Top?

    public init(pendingCount: Int, top: Top?) {
      self.pendingCount = pendingCount
      self.top = top
    }

    public struct Top: Codable, Hashable {
      public var id: String           // /r/<id> へ deeplink するため
      public var tag: String          // セッションタグ
      public var tool: String         // "Bash" / "Edit" / "Write" / "WebFetch"
      public var preview: String      // コマンドや path の先頭 80 文字程度
      public var createdAtMs: Int64   // 経過秒数表示に使う

      public init(id: String, tag: String, tool: String, preview: String, createdAtMs: Int64) {
        self.id = id
        self.tag = tag
        self.tool = tool
        self.preview = preview
        self.createdAtMs = createdAtMs
      }
    }
  }

  /// Activity 開始時に決まる属性 (以後変わらない)。
  /// 識別用に固定の名前を入れておく程度。
  public var startedAtMs: Int64

  public init(startedAtMs: Int64 = Int64(Date().timeIntervalSince1970 * 1000)) {
    self.startedAtMs = startedAtMs
  }
}
