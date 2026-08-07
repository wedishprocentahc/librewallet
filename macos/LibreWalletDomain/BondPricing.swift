import Foundation

/// Terms for Polish retail treasury bonds (parity with web `bondCurrentPrice`).
struct BondTerms: Hashable, Sendable {
    let code: String
    let termMonths: Int
    let firstYearRate: Double
    let margin: Double
    let indexation: String
    let capitalization: Bool
    let earlyRedemptionFee: Double
    let nominal: Double

    init(
        code: String,
        termMonths: Int,
        firstYearRate: Double,
        margin: Double,
        indexation: String,
        capitalization: Bool,
        earlyRedemptionFee: Double,
        nominal: Double = BondPricing.nominal
    ) {
        self.code = code.uppercased()
        self.termMonths = termMonths
        self.firstYearRate = firstYearRate
        self.margin = margin
        self.indexation = indexation
        self.capitalization = capitalization
        self.earlyRedemptionFee = earlyRedemptionFee
        self.nominal = nominal
    }

    var maturityDateFromPurchase: (Date) -> Date {
        { purchase in
            Calendar.current.date(byAdding: .month, value: termMonths, to: purchase) ?? purchase
        }
    }
}

enum BondPricing {
    static let nominal: Double = 100

    /// Estimated current value of 1 bond = nominal + accrued interest since purchase.
    /// For CPI-indexed bonds we approximate with first-year rate (same as web app).
    static func currentPrice(terms: BondTerms, purchaseDate: Date, asOf: Date = Date()) -> Double {
        let start = Calendar.current.startOfDay(for: purchaseDate)
        let maturity = terms.maturityDateFromPurchase(start)
        let reference: Date = {
            let day = Calendar.current.startOfDay(for: asOf)
            return day > maturity ? maturity : day
        }()

        let years = max(0, reference.timeIntervalSince(start) / (365.25 * 24 * 60 * 60))
        let rate = terms.firstYearRate / 100
        guard rate > 0, years > 0 else { return terms.nominal }

        if terms.capitalization {
            return terms.nominal * pow(1 + rate, years)
        }
        let fractionOfYear = years - floor(years)
        return terms.nominal * (1 + rate * fractionOfYear)
    }

    static func resolveTerms(symbol: String?, name: String?, notes: String?, assetType: String?) -> BondTerms? {
        if let parsed = parseNotes(notes) {
            return parsed
        }
        if let fromPreset = fromPreset(symbol: symbol) {
            return fromPreset
        }
        let looksLikeBond = (assetType ?? "").lowercased() == "bond"
            || (notes ?? "").localizedCaseInsensitiveContains("bond")
            || (name ?? "").localizedCaseInsensitiveContains("oblig")
        guard looksLikeBond else { return nil }
        return fromPreset(symbol: symbol)
    }

    static func fromPreset(symbol: String?) -> BondTerms? {
        guard let raw = symbol?.trimmingCharacters(in: .whitespacesAndNewlines), !raw.isEmpty else {
            return nil
        }
        let upper = raw.uppercased()
        // Exact code (OTS) or series like EDO0726 / COI1030
        if let preset = BondPresets.all.first(where: { $0.code == upper }) {
            return terms(from: preset)
        }
        if let preset = BondPresets.all.first(where: { upper.hasPrefix($0.code) }) {
            return terms(from: preset)
        }
        return nil
    }

    static func terms(from preset: BondPreset) -> BondTerms {
        BondTerms(
            code: preset.code,
            termMonths: preset.termMonths,
            firstYearRate: preset.firstYearRate,
            margin: preset.margin,
            indexation: preset.indexation,
            capitalization: preset.capitalization,
            earlyRedemptionFee: preset.earlyRedemptionFee
        )
    }

    /// Notes format from BondsView:
    /// `Bond OTS term=3m rate=3.0% margin=0.0 index=fixed cap=true fee=0.0`
    static func parseNotes(_ notes: String?) -> BondTerms? {
        guard let notes, notes.localizedCaseInsensitiveContains("bond") else { return nil }

        let code: String = {
            let tokens = notes.split(whereSeparator: { $0.isWhitespace })
            if tokens.count >= 2, tokens[0].lowercased() == "bond" {
                return String(tokens[1]).uppercased()
            }
            return BondPresets.all.first(where: { notes.uppercased().contains($0.code) })?.code ?? ""
        }()

        let term = matchNumber(in: notes, key: "term").map { Int($0) }
            ?? BondPresets.all.first(where: { $0.code == code })?.termMonths
            ?? 12
        let rate = matchNumber(in: notes, key: "rate")
            ?? BondPresets.all.first(where: { $0.code == code })?.firstYearRate
            ?? 0
        let margin = matchNumber(in: notes, key: "margin") ?? 0
        let indexation = matchToken(in: notes, key: "index") ?? "fixed"
        let capRaw = matchToken(in: notes, key: "cap")?.lowercased()
        let capitalization = capRaw == "true" || capRaw == "1" || capRaw == "yes"
        let fee = matchNumber(in: notes, key: "fee") ?? 0

        if code.isEmpty, rate <= 0 { return nil }

        return BondTerms(
            code: code.isEmpty ? "BOND" : code,
            termMonths: term,
            firstYearRate: rate,
            margin: margin,
            indexation: indexation,
            capitalization: capitalization,
            earlyRedemptionFee: fee
        )
    }

    private static func matchNumber(in text: String, key: String) -> Double? {
        let pattern = #"\#(key)\s*=\s*(-?\d+(?:[.,]\d+)?)"#
        guard let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]) else {
            return nil
        }
        let range = NSRange(text.startIndex..<text.endIndex, in: text)
        guard let match = regex.firstMatch(in: text, options: [], range: range),
              match.numberOfRanges >= 2,
              let valueRange = Range(match.range(at: 1), in: text) else {
            return nil
        }
        let raw = String(text[valueRange]).replacingOccurrences(of: ",", with: ".")
        return Double(raw)
    }

    private static func matchToken(in text: String, key: String) -> String? {
        let pattern = #"\#(key)\s*=\s*([A-Za-z0-9._+-]+)"#
        guard let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]) else {
            return nil
        }
        let range = NSRange(text.startIndex..<text.endIndex, in: text)
        guard let match = regex.firstMatch(in: text, options: [], range: range),
              match.numberOfRanges >= 2,
              let valueRange = Range(match.range(at: 1), in: text) else {
            return nil
        }
        return String(text[valueRange])
    }
}

struct BondLot: Hashable {
    var quantity: Double
    var purchaseDate: Date
    var terms: BondTerms
}
