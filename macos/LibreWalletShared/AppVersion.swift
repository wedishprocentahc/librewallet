import Foundation

enum AppVersion {
    static var shortVersion: String {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0.0.0"
    }

    static var buildNumber: String {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "0"
    }

    static var displayString: String {
        "\(shortVersion) (\(buildNumber))"
    }

    /// Returns true if `lhs` is strictly older than `rhs` (semver-ish: major.minor.patch).
    static func isVersion(_ lhs: String, olderThan rhs: String) -> Bool {
        compare(normalize(lhs), normalize(rhs)) == .orderedAscending
    }

    private static func normalize(_ raw: String) -> [Int] {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        let withoutV = trimmed.hasPrefix("v") || trimmed.hasPrefix("V")
            ? String(trimmed.dropFirst())
            : trimmed
        let core = withoutV.split(separator: "-", maxSplits: 1).first.map(String.init) ?? withoutV
        return core.split(separator: ".").prefix(3).map { Int($0) ?? 0 }
    }

    private static func compare(_ a: [Int], _ b: [Int]) -> ComparisonResult {
        let count = max(a.count, b.count)
        for i in 0 ..< count {
            let av = i < a.count ? a[i] : 0
            let bv = i < b.count ? b[i] : 0
            if av < bv { return .orderedAscending }
            if av > bv { return .orderedDescending }
        }
        return .orderedSame
    }
}
