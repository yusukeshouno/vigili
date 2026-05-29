import SwiftUI

/// フッターの QR アイコンを押したときに出る小さな popover。
/// iPhone との再ペアリング用 QR を表示する。
struct PairingQRPopover: View {
  @State private var payload: SetupPayload? = SetupPayload.compute()
  @State private var refreshTick = 0

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      Text("CONNECT YOUR IPHONE")
        .font(.mono(9, weight: .semibold))
        .tracking(0.12 * 9)
        .foregroundStyle(Theme.fgDim)

      HStack(spacing: 14) {
        qrBlock
        guide
      }
    }
    .padding(16)
    .frame(width: 320)
    .background(Theme.bg)
    .preferredColorScheme(.dark)
    // 初回で payload が nil だった場合は 1 秒後にリトライ (token / IP を待つ)
    .onAppear { retryIfNeeded() }
  }

  // MARK: - sub views

  private var qrBlock: some View {
    Group {
      if let p = payload, let img = qrImage(for: p.url, size: 120) {
        Image(nsImage: img)
          .resizable()
          .interpolation(.none)
          .frame(width: 120, height: 120)
          .padding(6)
          .background(RoundedRectangle(cornerRadius: 10).fill(Color.white))
      } else {
        RoundedRectangle(cornerRadius: 10)
          .fill(Theme.bgRise)
          .frame(width: 120, height: 120)
          .overlay(
            VStack(spacing: 6) {
              ProgressView().controlSize(.small)
              Text("preparing…")
                .font(.mono(9))
                .foregroundStyle(Theme.fgDim)
            }
          )
      }
    }
  }

  private var guide: some View {
    VStack(alignment: .leading, spacing: 8) {
      Text("iPhone の Camera でスキャンすると Vigili アプリが起動して接続します。")
        .font(.system(size: 11))
        .foregroundStyle(Theme.fgMid)
        .fixedSize(horizontal: false, vertical: true)

      if let p = payload {
        Text(p.host)
          .font(.mono(9))
          .foregroundStyle(Theme.fgDim)
          .lineLimit(2)
          .truncationMode(.middle)
          .textSelection(.enabled)
      } else {
        Text("daemon の起動を待っています…")
          .font(.mono(9))
          .foregroundStyle(Theme.fgDim)
      }

      Button {
        payload = SetupPayload.compute()
      } label: {
        HStack(spacing: 4) {
          Image(systemName: "arrow.clockwise")
            .font(.system(size: 9))
          Text("Refresh")
            .font(.mono(9))
        }
        .foregroundStyle(Theme.fgMid)
      }
      .buttonStyle(.plain)
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }

  // MARK: - helpers

  private func retryIfNeeded() {
    guard payload == nil else { return }
    DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) {
      payload = SetupPayload.compute()
      retryIfNeeded()
    }
  }
}
