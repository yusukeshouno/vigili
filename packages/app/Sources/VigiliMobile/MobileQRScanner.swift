import SwiftUI
import AVFoundation

/// 画面いっぱいにカメラプレビューを出し、QR が検出された瞬間に
/// `onScanned(payload)` を呼ぶ SwiftUI ビュー。
///
/// 期待する QR ペイロード:
///   {"u":"<host>","t":"<bearer>"}
///
/// 例: `{"u":"macbook-pro-5.tail11a843.ts.net","t":"ea3d3280..."}`
struct MobileQRScanner: View {
  let onScanned: (String) -> Void
  let onCancel: () -> Void

  var body: some View {
    ZStack {
      CameraPreview(onScanned: onScanned)
        .ignoresSafeArea()

      // ガイド枠 + 説明
      VStack {
        Spacer()
        ZStack {
          RoundedRectangle(cornerRadius: 24, style: .continuous)
            .stroke(Theme.accent, lineWidth: 2)
            .frame(width: 260, height: 260)
          // 4 隅にアクセントを置く
          cornerMark(.topLeading)
          cornerMark(.topTrailing)
          cornerMark(.bottomLeading)
          cornerMark(.bottomTrailing)
        }
        Spacer()
        Text("Scan the QR shown by `sentinel-cli setup-qr` on your Mac")
          .font(.mono(11))
          .foregroundStyle(Theme.fg)
          .multilineTextAlignment(.center)
          .padding(.horizontal, 36)
          .padding(.vertical, 12)
          .background(
            Capsule().fill(Color.black.opacity(0.55))
          )
          .padding(.bottom, 56)
      }

      // 閉じるボタン (右上)
      VStack {
        HStack {
          Spacer()
          Button {
            onCancel()
          } label: {
            Image(systemName: "xmark")
              .font(.system(size: 18, weight: .semibold))
              .foregroundStyle(.white)
              .padding(14)
              .background(Circle().fill(Color.black.opacity(0.45)))
          }
          .buttonStyle(.plain)
          .padding(.trailing, 18)
          .padding(.top, 56)
        }
        Spacer()
      }
    }
    .background(Color.black)
  }

  /// 4 隅の L 字マーク (横棒 + 縦棒)。260pt 枠の角に重ねる。
  private func cornerMark(_ alignment: Alignment) -> some View {
    ZStack {
      RoundedRectangle(cornerRadius: 2).fill(Theme.accent).frame(width: 22, height: 4)
      RoundedRectangle(cornerRadius: 2).fill(Theme.accent).frame(width: 4, height: 22)
    }
    .frame(width: 260, height: 260, alignment: alignment)
  }
}

// MARK: - AVCaptureSession を UIViewRepresentable で包む

private struct CameraPreview: UIViewRepresentable {
  let onScanned: (String) -> Void

  func makeCoordinator() -> Coordinator {
    Coordinator(onScanned: onScanned)
  }

  func makeUIView(context: Context) -> CameraPreviewView {
    let view = CameraPreviewView()
    context.coordinator.startSession(on: view)
    return view
  }

  func updateUIView(_ uiView: CameraPreviewView, context: Context) { /* no-op */ }

  static func dismantleUIView(_ uiView: CameraPreviewView, coordinator: Coordinator) {
    coordinator.stopSession()
  }

  // MARK: Coordinator

  final class Coordinator: NSObject, AVCaptureMetadataOutputObjectsDelegate {
    let onScanned: (String) -> Void
    private let session = AVCaptureSession()
    private var fired = false

    init(onScanned: @escaping (String) -> Void) {
      self.onScanned = onScanned
    }

    func startSession(on view: CameraPreviewView) {
      requestPermissionIfNeeded { [weak self] granted in
        guard let self = self, granted else { return }
        DispatchQueue.global(qos: .userInitiated).async {
          self.configureSession()
          DispatchQueue.main.async {
            view.setSession(self.session)
            if !self.session.isRunning {
              DispatchQueue.global(qos: .userInitiated).async {
                self.session.startRunning()
              }
            }
          }
        }
      }
    }

    func stopSession() {
      DispatchQueue.global(qos: .userInitiated).async {
        if self.session.isRunning { self.session.stopRunning() }
      }
    }

    private func requestPermissionIfNeeded(_ done: @escaping (Bool) -> Void) {
      switch AVCaptureDevice.authorizationStatus(for: .video) {
      case .authorized: done(true)
      case .notDetermined:
        AVCaptureDevice.requestAccess(for: .video) { granted in
          DispatchQueue.main.async { done(granted) }
        }
      default: done(false)
      }
    }

    private func configureSession() {
      session.beginConfiguration()
      defer { session.commitConfiguration() }
      session.sessionPreset = .high

      guard let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back),
            let input = try? AVCaptureDeviceInput(device: device),
            session.canAddInput(input) else { return }
      session.addInput(input)

      let metadata = AVCaptureMetadataOutput()
      guard session.canAddOutput(metadata) else { return }
      session.addOutput(metadata)
      metadata.setMetadataObjectsDelegate(self, queue: DispatchQueue.main)
      if metadata.availableMetadataObjectTypes.contains(.qr) {
        metadata.metadataObjectTypes = [.qr]
      }
    }

    // 検出 callback
    func metadataOutput(
      _ output: AVCaptureMetadataOutput,
      didOutput metadataObjects: [AVMetadataObject],
      from connection: AVCaptureConnection
    ) {
      guard !fired else { return }
      for obj in metadataObjects {
        if let q = obj as? AVMetadataMachineReadableCodeObject, q.type == .qr,
           let value = q.stringValue
        {
          fired = true
          // 一度発火したらすぐ stop して呼び戻す
          stopSession()
          UINotificationFeedbackGenerator().notificationOccurred(.success)
          onScanned(value)
          return
        }
      }
    }
  }
}

// MARK: - AVCaptureVideoPreviewLayer を持つ UIView

final class CameraPreviewView: UIView {
  override class var layerClass: AnyClass { AVCaptureVideoPreviewLayer.self }
  // swiftlint:disable:next force_cast
  var videoLayer: AVCaptureVideoPreviewLayer { layer as! AVCaptureVideoPreviewLayer }

  func setSession(_ session: AVCaptureSession) {
    videoLayer.session = session
    videoLayer.videoGravity = .resizeAspectFill
  }
}
