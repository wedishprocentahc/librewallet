import Foundation

enum AssetTypeDetection {
    static func detect(symbol: String?, name: String?) -> String {
        let symbol = (symbol ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let name = (name ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let text = normalize("\(symbol) \(name)")

        // Port of app.js detectAssetType()
        if matches(text, pattern: #"\b(vwce|vuaa|vusa|cspx|iwda|eimi|sxr8|swda|vwrl|acwi|qdve|is3n|iusq|eunl|emim|lcuw|meud|spyl|sppw|pr1w|vhyl|vgeg|veur|zprv|zprx|aggu|iuit|eqac)\b"#) {
            return "etf"
        }
        if matches(text, pattern: #"\b(etf|ucits|ishares|vanguard|xtrackers|amundi|lyxor|invesco|spdr|wisdomtree)\b"#) {
            return "etf"
        }
        if matches(text, pattern: #"\b(bond|oblig|treasury|skarb|edo|coi|tos|rod|rso|catalyst)\b"#) {
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

