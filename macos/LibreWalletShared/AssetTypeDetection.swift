import Foundation

enum AssetTypeDetection {
    static func detect(symbol: String?, name: String?) -> String {
        let symbol = (symbol ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let name = (name ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let text = normalize("\(symbol) \(name)")

        if isPolishOrGPWETFSymbol(symbol) {
            return "etf"
        }

        // Port of app.js detectAssetType()
        if matches(text, pattern: #"\b(vwce|vuaa|vusa|cspx|iwda|eimi|sxr8|swda|vwrl|acwi|qdve|is3n|iusq|eunl|emim|lcuw|meud|spyl|sppw|pr1w|vhyl|vgeg|veur|zprv|zprx|aggu|iuit|eqac|etfbw20tr|etfbm40tr|etfspltr|etfdaxpl|etfsp500)\b"#) {
            return "etf"
        }
        // "etf" as standalone word in name, or ETF-prefix tickers (ETFBW20TR.PL).
        if matches(text, pattern: #"\betf\b|\betf[a-z0-9]{2,}"#) {
            return "etf"
        }
        if matches(text, pattern: #"\b(etf|ucits|ishares|vanguard|xtrackers|amundi|lyxor|invesco|spdr|wisdomtree|beta etf)\b"#) {
            return "etf"
        }
        if matches(text, pattern: #"\b(bond|oblig|treasury|skarb|edo|coi|tos|rod|ros|ror|dor|ots|rso|catalyst)\b"#) {
            return "bond"
        }
        if symbol.isEmpty, matches(text, pattern: #"cash|gotow"#) {
            return "cash"
        }
        if !symbol.isEmpty {
            return "stock"
        }
        return "other"
    }

    /// GPW / XTB symbols like `ETFBW20TR.PL` — `\betf\b` misses them (no word boundary after ETF).
    private static func isPolishOrGPWETFSymbol(_ symbol: String) -> Bool {
        var base = symbol.uppercased()
        if base.hasSuffix(".PL") { base = String(base.dropLast(3)) }
        else if base.hasSuffix(".WA") { base = String(base.dropLast(3)) }
        return base.hasPrefix("ETF") && base.count > 3
    }

    private static func normalize(_ value: String) -> String {
        value.lowercased()
            .replacingOccurrences(of: "ł", with: "l")
            .replacingOccurrences(of: "ą", with: "a")
            .replacingOccurrences(of: "ę", with: "e")
            .replacingOccurrences(of: "ń", with: "n")
            .replacingOccurrences(of: "ó", with: "o")
            .replacingOccurrences(of: "ś", with: "s")
            .replacingOccurrences(of: "ż", with: "z")
            .replacingOccurrences(of: "ź", with: "z")
    }

    private static func matches(_ value: String, pattern: String) -> Bool {
        guard let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]) else {
            return false
        }
        return regex.firstMatch(in: value, range: NSRange(value.startIndex..., in: value)) != nil
    }
}

