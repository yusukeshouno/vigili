import Foundation
import Combine

/// 直近 N 行だけメモリに保持するリングバッファ。
/// SwiftUI 側からは `lines` を逆順表示することが多いので、
/// observable な配列をそのまま提供する。
@MainActor
final class DaemonLogBuffer: ObservableObject {
  @Published private(set) var lines: [LogLine] = []
  private let capacity: Int

  struct LogLine: Identifiable, Hashable {
    let id = UUID()
    let timestamp: Date
    let text: String
  }

  init(capacity: Int = 1000) {
    self.capacity = capacity
    self.lines.reserveCapacity(capacity)
  }

  func append(line: String) {
    lines.append(LogLine(timestamp: Date(), text: line))
    if lines.count > capacity {
      lines.removeFirst(lines.count - capacity)
    }
  }

  func clear() {
    lines.removeAll()
  }
}
