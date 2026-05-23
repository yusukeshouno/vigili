import Foundation
import CoreText

/// アプリ起動直後に .ttf を CoreText に登録する。
///
/// macOS の `ATSApplicationFontsPath` は機種・状況によって不安定なので、
/// `CTFontManagerRegisterFontsForURL` で明示登録するのが堅い。
enum FontRegistration {
  static func registerBundledFonts() {
    let names = ["BricolageGrotesque", "JetBrainsMono"]
    for name in names {
      guard let url = Bundle.main.url(forResource: name, withExtension: "ttf") else {
        NSLog("[Sentinel.app] font \(name).ttf not found in bundle")
        continue
      }
      var error: Unmanaged<CFError>?
      let ok = CTFontManagerRegisterFontsForURL(url as CFURL, .process, &error)
      if !ok {
        let msg = (error?.takeRetainedValue() as Error?)?.localizedDescription ?? "unknown"
        // already-registered は許容
        if !msg.contains("already") {
          NSLog("[Sentinel.app] font register \(name) failed: \(msg)")
        }
      }
    }
  }
}
