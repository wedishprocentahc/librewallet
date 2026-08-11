import Foundation
import SwiftData

enum PricingService {
    enum FetchError: Error, LocalizedError {
        case unresolved(String)
        case ignored(String)
        case currencyMismatch(expected: String, got: String, providerSymbol: String)
        case noData(String)
        case http(Int)

        var errorDescription: String? {
            switch self {
            case .unresolved(let s):
                return "Brak mapowania tickera dla \(s). Ustaw symbol Yahoo w Ustawieniach."
            case .ignored(let s):
                return "Symbol \(s) jest ignorowany (zła wycena Yahoo vs XTB)."
            case .currencyMismatch(let expected, let got, let providerSymbol):
                return "Yahoo \(providerSymbol) ma walutę \(got), oczekiwano \(expected)."
            case .noData(let s):
                return "Brak danych Yahoo dla \(s)."
            case .http(let code):
                return "Yahoo HTTP \(code)."
            }
        }
    }

    static func refreshQuotes(for transactions: [Transaction], context: ModelContext) async throws {
        let symbols = Set(transactions.compactMap { $0.symbol?.uppercased() }.filter { !$0.isEmpty })
        let currencyBySymbol = symbolCurrencies(from: transactions)
        try await refreshQuotes(symbols: Array(symbols), currencyBySymbol: currencyBySymbol, context: context)
    }

    static func refreshQuotes(
        symbols: [String],
        currencyBySymbol: [String: String] = [:],
        context: ModelContext
    ) async throws {
        for symbol in symbols {
            let preferredCurrency = currencyBySymbol[symbol.uppercased()]
            do {
                let quote = try await fetchQuote(xtbSymbol: symbol, positionCurrency: preferredCurrency)
                await MainActor.run {
                    upsertQuote(symbol: symbol.uppercased(), quote: quote, context: context)
                    AppPreferences.setQuoteMeta(
                        QuoteResolutionMeta(
                            provider: quote.resolved.provider,
                            providerSymbol: quote.resolved.providerSymbol,
                            currency: quote.currency,
                            asOf: quote.asOf
                        ),
                        forXTB: symbol
                    )
                }
            } catch FetchError.ignored {
                continue
            } catch {
                // Skip individual symbol failures so one bad ticker doesn't abort the batch.
                continue
            }
        }
        try await MainActor.run {
            try context.save()
        }
    }

    /// Refresh a single XTB symbol (e.g. after mapping override). Throws on failure.
    static func refreshQuote(
        xtbSymbol: String,
        positionCurrency: String?,
        context: ModelContext
    ) async throws {
        let quote = try await fetchQuote(xtbSymbol: xtbSymbol, positionCurrency: positionCurrency)
        try await MainActor.run {
            upsertQuote(symbol: xtbSymbol.uppercased(), quote: quote, context: context)
            AppPreferences.setQuoteMeta(
                QuoteResolutionMeta(
                    provider: quote.resolved.provider,
                    providerSymbol: quote.resolved.providerSymbol,
                    currency: quote.currency,
                    asOf: quote.asOf
                ),
                forXTB: xtbSymbol
            )
            try context.save()
        }
    }

    struct PriceHistoryPoint: Codable {
        let date: Date
        let close: Double
    }

    /// Fetches daily close history for the given held symbols and persists it to a JSON
    /// cache on disk (so the dashboard chart can value historical days at market prices
    /// without hitting the network on every launch). Returns the merged history keyed by
    /// the uppercased symbol as used in transactions.
    static func refreshHistories(symbols: [String]) async -> [String: [(date: Date, close: Double)]] {
        var result = loadCachedHistories()
        for symbol in symbols {
            let key = symbol.uppercased()
            if let history = try? await fetchHistory(xtbSymbol: symbol), !history.isEmpty {
                result[key] = history
            }
        }
        saveHistories(result)
        return result
    }

    static func historyCacheURL() -> URL {
        let appSupport = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        let dir = appSupport.appendingPathComponent("LibreWallet", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent("price-history.json")
    }

    static func loadCachedHistories() -> [String: [(date: Date, close: Double)]] {
        guard let data = try? Data(contentsOf: historyCacheURL()),
              let decoded = try? JSONDecoder().decode([String: [PriceHistoryPoint]].self, from: data) else {
            return [:]
        }
        return decoded.mapValues { points in points.map { (date: $0.date, close: $0.close) } }
    }

    static func saveHistories(_ histories: [String: [(date: Date, close: Double)]]) {
        let encodable = histories.mapValues { points in points.map { PriceHistoryPoint(date: $0.date, close: $0.close) } }
        if let data = try? JSONEncoder().encode(encodable) {
            try? data.write(to: historyCacheURL(), options: .atomic)
        }
    }

    static func fetchHistory(symbol: String) async throws -> [(date: Date, close: Double)] {
        try await fetchHistory(xtbSymbol: symbol)
    }

    static func fetchHistory(xtbSymbol: String, positionCurrency: String? = nil) async throws -> [(date: Date, close: Double)] {
        let resolved = try resolveOrThrow(xtbSymbol: xtbSymbol, positionCurrency: positionCurrency)
        let encoded = resolved.providerSymbol.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed)
            ?? resolved.providerSymbol
        guard let url = URL(string: "https://query1.finance.yahoo.com/v8/finance/chart/\(encoded)?period1=0&period2=\(Int(Date().timeIntervalSince1970))&interval=1d&events=history") else {
            return []
        }
        var request = URLRequest(url: url)
        request.setValue("Mozilla/5.0", forHTTPHeaderField: "User-Agent")
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            throw FetchError.http((response as? HTTPURLResponse)?.statusCode ?? -1)
        }
        guard let payload = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let chart = payload["chart"] as? [String: Any],
              let result = (chart["result"] as? [[String: Any]])?.first,
              let timestamps = result["timestamp"] as? [Int],
              let indicators = result["indicators"] as? [String: Any],
              let quote = (indicators["quote"] as? [[String: Any]])?.first,
              let closes = quote["close"] as? [Double?] else {
            return []
        }

        // Currency hard-fail when meta is present.
        if let meta = result["meta"] as? [String: Any],
           let ccy = (meta["currency"] as? String)?.uppercased(),
           ccy != resolved.expectedCurrency {
            throw FetchError.currencyMismatch(
                expected: resolved.expectedCurrency,
                got: ccy,
                providerSymbol: resolved.providerSymbol
            )
        }

        var out: [(Date, Double)] = []
        for (index, ts) in timestamps.enumerated() where index < closes.count {
            guard let close = closes[index] else { continue }
            out.append((Date(timeIntervalSince1970: TimeInterval(ts)), close))
        }
        return out
    }

    // MARK: - Resolve + fetch

    struct FetchedQuote {
        let price: Double
        let currency: String
        let asOf: Date
        let resolved: ResolvedSymbol
    }

    static func fetchQuote(xtbSymbol: String, positionCurrency: String?) async throws -> FetchedQuote {
        let resolved = try resolveOrThrow(xtbSymbol: xtbSymbol, positionCurrency: positionCurrency)
        let encoded = resolved.providerSymbol.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed)
            ?? resolved.providerSymbol
        guard let url = URL(string: "https://query1.finance.yahoo.com/v8/finance/chart/\(encoded)?interval=1d&range=5d") else {
            throw FetchError.noData(resolved.providerSymbol)
        }
        var request = URLRequest(url: url)
        request.setValue("Mozilla/5.0", forHTTPHeaderField: "User-Agent")
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            throw FetchError.http((response as? HTTPURLResponse)?.statusCode ?? -1)
        }
        guard let payload = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let chart = payload["chart"] as? [String: Any],
              let result = (chart["result"] as? [[String: Any]])?.first,
              let meta = result["meta"] as? [String: Any] else {
            throw FetchError.noData(resolved.providerSymbol)
        }
        let price = (meta["regularMarketPrice"] as? Double)
            ?? (meta["previousClose"] as? Double)
            ?? 0
        guard price > 0 else { throw FetchError.noData(resolved.providerSymbol) }

        let currency = ((meta["currency"] as? String) ?? resolved.expectedCurrency).uppercased()
        if currency != resolved.expectedCurrency {
            throw FetchError.currencyMismatch(
                expected: resolved.expectedCurrency,
                got: currency,
                providerSymbol: resolved.providerSymbol
            )
        }

        let asOf = Date(timeIntervalSince1970: (meta["regularMarketTime"] as? Double) ?? Date().timeIntervalSince1970)
        return FetchedQuote(price: price, currency: currency, asOf: asOf, resolved: resolved)
    }

    private static func resolveOrThrow(xtbSymbol: String, positionCurrency: String?) throws -> ResolvedSymbol {
        switch SymbolResolver.resolve(xtbSymbol: xtbSymbol, positionCurrency: positionCurrency) {
        case .success(let resolved):
            return resolved
        case .failure(.ignored):
            throw FetchError.ignored(xtbSymbol.uppercased())
        case .failure(.unresolved(let s)):
            throw FetchError.unresolved(s)
        case .failure(.emptySymbol):
            throw FetchError.unresolved(xtbSymbol)
        }
    }

    @MainActor
    private static func upsertQuote(symbol: String, quote: FetchedQuote, context: ModelContext) {
        let descriptor = FetchDescriptor<Quote>(predicate: #Predicate { $0.symbol == symbol })
        if let existing = try? context.fetch(descriptor).first {
            existing.price = quote.price
            existing.currency = quote.currency
            existing.asOf = quote.asOf
            return
        }
        context.insert(Quote(symbol: symbol, currency: quote.currency, price: quote.price, asOf: quote.asOf))
    }

    private static func symbolCurrencies(from transactions: [Transaction]) -> [String: String] {
        var counts: [String: [String: Int]] = [:]
        for tx in transactions {
            guard let symbol = tx.symbol?.uppercased(), !symbol.isEmpty else { continue }
            let currency = CurrencyCode.normalize(tx.currency)
            counts[symbol, default: [:]][currency, default: 0] += 1
        }
        return counts.mapValues { $0.max(by: { $0.value < $1.value })?.key ?? "PLN" }
    }
}
