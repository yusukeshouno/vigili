import AppKit
import CoreImage.CIFilterBuiltins
import Foundation
import SwiftUI

/// 初回起動時のオンボーディング。
///
/// 目的:
///  1. 「Vigili が何のためのアプリか」を 3 行で伝える
///  2. iPhone との接続 QR を 1 画面で出して、Camera.app から取り込ませる
///  3. 「Got it」で marker file を書いて二度と出さない (AppCoordinator.dismissWelcome)
///
/// QR の中身は `sentinel://setup?u=<lan_ip:7878>&t=<token>` 形式 (既存 iOS Setup と同じ)。
/// 外出先用の relay ペアリングは別途 `vigili-cli pair` でやってもらう (CLI で完結)。
struct WelcomeView: View {
  @EnvironmentObject private var coordinator: AppCoordinator

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      header
      Spacer(minLength: 18)
      intro
      Spacer(minLength: 22)
      qrSection
      Spacer(minLength: 22)
      footer
    }
    .padding(.horizontal, 22)
    .padding(.vertical, 22)
    .background(Theme.bg)
    .preferredColorScheme(.dark)
  }

  // MARK: - sections

  private var header: some View {
    HStack(spacing: 12) {
      FlowerLogo(color: Theme.accent, size: 22)
      Text("Welcome to Vigili")
        .font(.display(18, weight: .semibold))
        .foregroundStyle(Theme.fg)
    }
  }

  private var intro: some View {
    VStack(alignment: .leading, spacing: 10) {
      bullet(
        "Claude Code がツール承認を求めるたびに、ローカルポリシーが allow/deny/ask を分類。",
      )
      bullet(
        "「人間が判断すべき」だけ手元の iPhone に飛ぶ。2 タップで承認。",
      )
      bullet(
        "デフォルトで使えるポリシーは ~/.vigili/policy.yaml に書き出しました。",
      )
    }
  }

  private func bullet(_ text: String) -> some View {
    HStack(alignment: .top, spacing: 8) {
      Text("·")
        .font(.system(size: 14, weight: .bold))
        .foregroundStyle(Theme.accent)
      Text(text)
        .font(.system(size: 12))
        .foregroundStyle(Theme.fgMid)
        .lineSpacing(2)
        .fixedSize(horizontal: false, vertical: true)
    }
  }

  private var qrSection: some View {
    let payload = SetupPayload.compute()
    return VStack(alignment: .leading, spacing: 10) {
      Text("CONNECT YOUR PHONE")
        .font(.mono(9, weight: .semibold))
        .tracking(0.12 * 9)
        .foregroundStyle(Theme.fgDim)

      HStack(spacing: 16) {
        // QR
        if let payload = payload, let qr = qrImage(for: payload.url, size: 132) {
          Image(nsImage: qr)
            .resizable()
            .interpolation(.none)
            .frame(width: 132, height: 132)
            .padding(8)
            .background(RoundedRectangle(cornerRadius: 12).fill(Color.white))
        } else {
          // token / IP がまだ取れない場合のプレースホルダ
          RoundedRectangle(cornerRadius: 12)
            .fill(Theme.bgRise)
            .frame(width: 132, height: 132)
            .overlay(
              VStack(spacing: 6) {
                ProgressView().controlSize(.small)
                Text("preparing…")
                  .font(.mono(9))
                  .foregroundStyle(Theme.fgDim)
              }
            )
        }

        // 右側ガイド
        VStack(alignment: .leading, spacing: 8) {
          Text("iPhone の Camera.app でこの QR を読み取ると、Vigili モバイル app が起動して接続まで自動で進みます。")
            .font(.system(size: 11))
            .foregroundStyle(Theme.fgMid)
            .fixedSize(horizontal: false, vertical: true)
          if let p = payload {
            Text(p.url)
              .font(.mono(9))
              .foregroundStyle(Theme.fgDim)
              .lineLimit(2)
              .truncationMode(.middle)
              .textSelection(.enabled)
          } else {
            Text("daemon の token / LAN IP を待っています…")
              .font(.mono(9))
              .foregroundStyle(Theme.fgDim)
          }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
      }
    }
  }

  private var footer: some View {
    HStack {
      Text("Out-of-LAN access? Run `vigili-cli pair` in your terminal.")
        .font(.mono(9))
        .foregroundStyle(Theme.fgDim)
      Spacer()
      Button(action: { coordinator.dismissWelcome() }) {
        Text("Got it")
          .font(.system(size: 12, weight: .semibold))
          .padding(.horizontal, 14)
          .padding(.vertical, 6)
          .background(Capsule().fill(Theme.accent))
          .foregroundStyle(.white)
      }
      .buttonStyle(.plain)
    }
  }
}

// MARK: - QR

/// `CIQRCodeGenerator` で QR を生成して NSImage に焼く。
/// `CIFilter.qrCodeGenerator()` は iOS / Mac 共通。
func qrImage(for string: String, size: CGFloat) -> NSImage? {
  guard let data = string.data(using: .utf8) else { return nil }
  let filter = CIFilter.qrCodeGenerator()
  filter.message = data
  filter.correctionLevel = "M"
  guard let ciImage = filter.outputImage else { return nil }
  // 元解像度は 25x25 程度なので、ピクセルそのまま拡大して .none で nearest-neighbor 描画する。
  let scale = size / ciImage.extent.width
  let scaled = ciImage.transformed(by: CGAffineTransform(scaleX: scale, y: scale))
  let context = CIContext()
  guard let cgImage = context.createCGImage(scaled, from: scaled.extent) else { return nil }
  return NSImage(cgImage: cgImage, size: NSSize(width: size, height: size))
}

// MARK: - Setup payload (LAN IP + token)

struct SetupPayload {
  let host: String      // 例: "192.168.1.5:7878"
  let token: String
  let url: String       // "sentinel://setup?u=<host>&t=<token>"

  /// 同期で叩いて返す。token / LAN IP が揃わなければ nil。
  /// (起動直後は daemon が token を書く前のことがあるので呼び出し側でリトライする想定)
  static func compute() -> SetupPayload? {
    let token = DaemonWsClient.macHomeToken()
    guard !token.isEmpty else { return nil }
    guard let ip = detectLanIp() else { return nil }
    let host = "\(ip):7878"
    let url = "sentinel://setup?u=\(host.addingPercentEncoding(withAllowedCharacters: .urlHostAllowed) ?? host)&t=\(token.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? token)"
    return SetupPayload(host: host, token: token, url: url)
  }

  /// `ipconfig getifaddr <iface>` を順に試して最初に取れた IP を返す。
  /// App Sandbox はオフなので Process を直接叩ける。
  /// loopback / link-local / 169.254. は ipconfig が elide してくれる。
  static func detectLanIp() -> String? {
    for iface in ["en0", "en1", "en2", "en3"] {
      if let addr = runIpconfig(iface: iface), !addr.isEmpty, !addr.hasPrefix("169.254.") {
        return addr
      }
    }
    return nil
  }

  private static func runIpconfig(iface: String) -> String? {
    let task = Process()
    task.launchPath = "/usr/sbin/ipconfig"
    task.arguments = ["getifaddr", iface]
    let pipe = Pipe()
    task.standardOutput = pipe
    task.standardError = Pipe()
    do {
      try task.run()
    } catch {
      return nil
    }
    task.waitUntilExit()
    let data = pipe.fileHandleForReading.readDataToEndOfFile()
    let out = String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines)
    if task.terminationStatus != 0 { return nil }
    return out
  }
}
