import Foundation
import ActivityKit

/// `MobileAppCoordinator` から呼ばれる Live Activity の lifecycle 管理。
///
/// pending 数が変化したら:
///  - 0 → 1: 新しい Activity を start
///  - 1 → N: 既存 Activity を update
///  - N → 0: end
///
/// iOS が許可してない / Live Activity 非対応のときは黙って no-op になる。
@MainActor
final class LiveActivityManager {
  private var current: Activity<SentinelActivityAttributes>?

  /// pending リストを反映する。引数は MobileAppCoordinator が持つ pending 配列。
  func sync(pending: [ApprovalRequest]) {
    let count = pending.count
    let topReq = pending.max(by: { $0.createdAt < $1.createdAt })  // 一番新しいもの

    if count == 0 {
      end()
      return
    }

    let top = topReq.map { req in
      SentinelActivityAttributes.ContentState.Top(
        id: req.id,
        tag: req.sessionTag ?? "untagged",
        tool: req.toolName,
        preview: trimPreview(req.primaryPreview),
        createdAtMs: Int64(req.createdAt.timeIntervalSince1970 * 1000)
      )
    }
    let state = SentinelActivityAttributes.ContentState(pendingCount: count, top: top)

    if let activity = current {
      Task { await activity.update(ActivityContent(state: state, staleDate: nil)) }
    } else {
      start(state: state)
    }
  }

  private func start(state: SentinelActivityAttributes.ContentState) {
    // 端末側の許可を確認
    let info = ActivityAuthorizationInfo()
    guard info.areActivitiesEnabled else {
      appLog("LiveActivity: areActivitiesEnabled=false (Settings → Notifications で許可が必要)")
      return
    }

    let attributes = SentinelActivityAttributes()
    do {
      let activity = try Activity.request(
        attributes: attributes,
        content: ActivityContent(state: state, staleDate: Date().addingTimeInterval(60 * 30)),  // 30 分後に stale
        pushType: nil  // ローカル更新のみ。将来 APNs Push 経由で更新可能にする予定。
      )
      current = activity
      appLog("LiveActivity: started \(activity.id)")
    } catch {
      appLog("LiveActivity: start failed \(error.localizedDescription)")
    }
  }

  private func end() {
    guard let activity = current else { return }
    let final = SentinelActivityAttributes.ContentState(pendingCount: 0, top: nil)
    Task {
      await activity.end(
        ActivityContent(state: final, staleDate: nil),
        dismissalPolicy: .immediate
      )
      appLog("LiveActivity: ended \(activity.id)")
    }
    current = nil
  }

  /// 起動時に過去の Activity をクリーンアップ (再起動で取り残されたものを潰す)。
  func clearStaleActivitiesOnLaunch() {
    Task {
      for activity in Activity<SentinelActivityAttributes>.activities {
        await activity.end(nil, dismissalPolicy: .immediate)
      }
    }
  }

  private func trimPreview(_ s: String) -> String {
    if s.count <= 80 { return s }
    return String(s.prefix(78)) + "…"
  }
}
