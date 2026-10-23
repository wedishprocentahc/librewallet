import Foundation

enum SymbolResolveError: Error, Equatable {
    case emptySymbol
    case ignored
    case unresolved(String)
}

struct ResolvedSymbol: Hashable {
    let xtbSymbol: String
    let provider: QuoteProvider
    let providerSymbol: String
    let expectedCurrency: String
    /// True when resolution came from a user override.
    let fromOverride: Bool
    /// Currency the listing is quoted in (USD/EUR markets only). A quote in this currency is
    /// accepted even when the position lives in another account currency (e.g. NVDA.US held in
    /// a PLN account); the price is converted with NBP rates when valuing the position.
    /// GBP is deliberately excluded: Yahoo reports London prices in pence (GBp).
    var nativeCurrency: String? = nil

    func accepts(currency: String) -> Bool {
        let c = currency.uppercased()
        return c == expectedCurrency || c == nativeCurrency
    }
}

enum SymbolResolver {
    /// Symbols we never fetch (known Yahoo ≠ broker mismatches).
    static let ignoredBases: Set<String> = ["EEE"]

    static func normalizeXTB(_ raw: String) -> String {
        raw.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
    }

    static func isIgnored(_ xtbSymbol: String) -> Bool {
        let upper = normalizeXTB(xtbSymbol)
        let base = upper.split(separator: ".").first.map(String.init) ?? upper
        return ignoredBases.contains(base)
    }

    /// Deterministic 1:1 resolve. Override wins over market rules.
    static func resolve(
        xtbSymbol: String,
        positionCurrency: String? = nil,
        overrides: [SymbolMapping] = AppPreferences.symbolMappings
    ) -> Result<ResolvedSymbol, SymbolResolveError> {
        let xtb = normalizeXTB(xtbSymbol)
        guard !xtb.isEmpty else { return .failure(.emptySymbol) }
        if isIgnored(xtb) { return .failure(.ignored) }

        let posCcy = positionCurrency.map { CurrencyCode.normalize($0) }

        if let override = overrides.first(where: { $0.id == xtb }) {
            let expected = expectedCurrency(forXTB: xtb, positionCurrency: posCcy ?? "PLN")
            return .success(ResolvedSymbol(
                xtbSymbol: xtb,
                provider: override.provider,
                providerSymbol: override.providerSymbol,
                expectedCurrency: expected,
                fromOverride: true
            ))
        }

        guard let rule = marketRule(for: xtb) else {
            return .failure(.unresolved(xtb))
        }

        let expected = posCcy ?? rule.expectedCurrency
        return .success(ResolvedSymbol(
            xtbSymbol: xtb,
            provider: .yahoo,
            providerSymbol: rule.providerSymbol,
            expectedCurrency: expected,
            fromOverride: false,
            nativeCurrency: ["USD", "EUR"].contains(rule.expectedCurrency) ? rule.expectedCurrency : nil
        ))
    }

    /// Expected quote currency from XTB suffix.
    static func expectedCurrency(forXTB xtb: String, positionCurrency: String = "PLN") -> String {
        if let rule = marketRule(for: normalizeXTB(xtb)) {
            if !positionCurrency.isEmpty {
                return CurrencyCode.normalize(positionCurrency)
            }
            return rule.expectedCurrency
        }
        return CurrencyCode.normalize(positionCurrency)
    }

    // MARK: - Market rules (no bare GPW tickers)

    private struct MarketRule {
        let providerSymbol: String
        let expectedCurrency: String
    }

    private static func marketRule(for xtb: String) -> MarketRule? {
        if xtb.hasPrefix("^") {
            return MarketRule(providerSymbol: xtb, expectedCurrency: "USD")
        }

        let parts = xtb.split(separator: ".", maxSplits: 1).map(String.init)
        let base = parts.first ?? xtb
        let suffix = parts.count > 1 ? parts[1] : ""

        switch suffix {
        case "PL":
            // Always Warsaw Yahoo suffix — never bare `BASE` (DIA collision).
            return MarketRule(providerSymbol: "\(base).WA", expectedCurrency: "PLN")
        case "WA":
            return MarketRule(providerSymbol: xtb, expectedCurrency: "PLN")
        case "US":
            return MarketRule(providerSymbol: base, expectedCurrency: "USD")
        case "UK":
            return MarketRule(providerSymbol: "\(base).L", expectedCurrency: "GBP")
        case "DE", "FR":
            return MarketRule(providerSymbol: xtb, expectedCurrency: "EUR")
        case "L":
            return MarketRule(providerSymbol: xtb, expectedCurrency: "GBP")
        case "":
            // Bare symbols only via override.
            return nil
        default:
            // Unknown suffix: try as-is on Yahoo (still deterministic, one symbol).
            return MarketRule(providerSymbol: xtb, expectedCurrency: "PLN")
        }
    }
}
