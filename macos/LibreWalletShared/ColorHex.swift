import SwiftUI
#if canImport(AppKit)
import AppKit
#endif

extension Color {
    init?(hex: String) {
        var s = hex.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        if s.hasPrefix("#") { s.removeFirst() }
        guard s.count == 6 else { return nil }
        guard let value = UInt64(s, radix: 16) else { return nil }
        let r = Double((value >> 16) & 0xFF) / 255.0
        let g = Double((value >> 8) & 0xFF) / 255.0
        let b = Double(value & 0xFF) / 255.0
        self = Color(.sRGB, red: r, green: g, blue: b, opacity: 1.0)
    }

    /// Reliable sRGB hex for colors coming from `ColorPicker` (catalog / display-P3 / etc.).
    func toHex() -> String? {
        #if canImport(AppKit)
        let ns = NSColor(self)

        if let rgb = ns.usingColorSpace(.deviceRGB) ?? ns.usingColorSpace(.sRGB) {
            var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
            rgb.getRed(&r, green: &g, blue: &b, alpha: &a)
            return String(
                format: "#%02X%02X%02X",
                Int((r * 255).rounded()),
                Int((g * 255).rounded()),
                Int((b * 255).rounded())
            )
        }

        if let srgb = CGColorSpace(name: CGColorSpace.sRGB),
           let converted = ns.cgColor.converted(to: srgb, intent: .relativeColorimetric, options: nil),
           let comps = converted.components,
           comps.count >= 3 {
            return String(
                format: "#%02X%02X%02X",
                Int((comps[0] * 255).rounded()),
                Int((comps[1] * 255).rounded()),
                Int((comps[2] * 255).rounded())
            )
        }

        return nil
        #else
        return nil
        #endif
    }
}
