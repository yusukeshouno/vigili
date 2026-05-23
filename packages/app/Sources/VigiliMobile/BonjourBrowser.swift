import Foundation
import Network
import Combine

/// 同 LAN 上の Sentinel daemon を Bonjour (`_sentinel._tcp`) で見つける。
///
/// daemon 側は `bonjour-service` で publish 済み。
/// iOS は `NWBrowser` を使って同じ type を browse。発見したらホスト名 + ポートを返す。
@MainActor
final class BonjourBrowser: ObservableObject {
  struct Service: Identifiable, Hashable {
    let id: String     // displayable identity (name + interface)
    let name: String   // "Sentinel"
    let endpoint: NWEndpoint
    /// `ws://<host>:<port>` を構築できる形に解決した URL。nil なら未解決。
    var resolvedURL: URL?
  }

  @Published private(set) var services: [Service] = []
  @Published private(set) var isBrowsing: Bool = false

  private var browser: NWBrowser?

  func start() {
    guard browser == nil else { return }
    let params = NWParameters()
    params.includePeerToPeer = true
    let descriptor = NWBrowser.Descriptor.bonjour(type: "_sentinel._tcp", domain: nil)
    let b = NWBrowser(for: descriptor, using: params)
    self.browser = b
    isBrowsing = true

    b.stateUpdateHandler = { [weak self] state in
      Task { @MainActor [weak self] in
        switch state {
        case .ready, .setup:
          self?.isBrowsing = true
        case .failed, .cancelled:
          self?.isBrowsing = false
        default:
          break
        }
      }
    }

    b.browseResultsChangedHandler = { [weak self] results, _ in
      let mapped: [Service] = results.compactMap { r in
        guard case let .service(name, _, _, _) = r.endpoint else { return nil }
        return Service(
          id: "\(name)#\(r.metadata)",
          name: name,
          endpoint: r.endpoint,
          resolvedURL: nil
        )
      }
      Task { @MainActor [weak self] in
        self?.services = mapped
        // 結果が来たら順次 resolve
        for (idx, svc) in mapped.enumerated() {
          self?.resolve(svc, indexHint: idx)
        }
      }
    }

    b.start(queue: .main)
  }

  func stop() {
    browser?.cancel()
    browser = nil
    services = []
    isBrowsing = false
  }

  /// Bonjour endpoint → 実 IP:port に解決して URL を組み立てる。
  /// NWConnection を一瞬だけ張って resolved endpoint を覗き、すぐ閉じる。
  private func resolve(_ service: Service, indexHint: Int) {
    let conn = NWConnection(to: service.endpoint, using: .tcp)
    conn.stateUpdateHandler = { [weak self] state in
      switch state {
      case .ready:
        if let inner = conn.currentPath?.remoteEndpoint {
          let url = Self.endpointToWsURL(inner)
          conn.cancel()
          Task { @MainActor [weak self] in
            self?.updateResolved(serviceId: service.id, url: url)
          }
        } else {
          conn.cancel()
        }
      case .failed, .cancelled:
        break
      default:
        break
      }
    }
    conn.start(queue: .global(qos: .utility))
  }

  private func updateResolved(serviceId: String, url: URL?) {
    guard let idx = services.firstIndex(where: { $0.id == serviceId }) else { return }
    var copy = services
    copy[idx].resolvedURL = url
    services = copy
  }

  /// pure 関数なので @MainActor から外す。background queue から呼んでも安全。
  private nonisolated static func endpointToWsURL(_ ep: NWEndpoint) -> URL? {
    switch ep {
    case .hostPort(let host, let port):
      let h: String
      switch host {
      case .ipv4(let v4):
        h = "\(v4)"
      case .ipv6(let v6):
        h = "[\(v6)]"
      case .name(let name, _):
        h = name
      @unknown default:
        return nil
      }
      return URL(string: "ws://\(h):\(port.rawValue)")
    default:
      return nil
    }
  }
}
