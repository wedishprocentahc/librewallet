import Foundation
import SwiftData

enum PricingService {
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
        // SwiftData ModelContext is not thread-safe; only touch it on MainActor.
        for symbol in symbols {
            let preferredCurrency = currencyBySymbol[symbol.uppercased()]
            if let quote = try await fetchYahooQuote(symbol: symbol, preferredCurrency: preferredCurrency) {
                await MainActor.run {
                    upsertQuote(symbol: symbol.uppercased(), quote: quote, context: context)
                }
            }
        }
        try await MainActor.run {
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
            if let history = try? await fetchHistory(symbol: symbol), !history.isEmpty {
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
        for candidate in yahooCandidates(symbol) {
            guard let url = URL(string: "https://query1.finance.yahoo.com/v8/finance/chart/\(candidate)?period1=0&period2=\(Int(Date().timeIntervalSince1970))&interval=1d&events=history") else {
                continue
            }
            var request = URLRequest(url: url)
            request.setValue("Mozilla/5.0", forHTTPHeaderField: "User-Agent")
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse, http.statusCode == 200 else { continue }
            guard let payload = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let chart = payload["chart"] as? [String: Any],
                  let result = (chart["result"] as? [[String: Any]])?.first,
                  let timestamps = result["timestamp"] as? [Int],
                  let indicators = result["indicators"] as? [String: Any],
                  let quote = (indicators["quote"] as? [[String: Any]])?.first,
                  let closes = quote["close"] as? [Double?] else {
                continue
            }

            var out: [(Date, Double)] = []
            for (index, ts) in timestamps.enumerated() where index < closes.count {
                guard let close = closes[index] else { continue }
                out.append((Date(timeIntervalSince1970: TimeInterval(ts)), close))
            }
            if !out.isEmpty { return out }
        }
        return []
    }

    private static func fetchYahooQuote(
        symbol: String,
        preferredCurrency: String?
    ) async throws -> (price: Double, currency: String, asOf: Date)? {
        for candidate in yahooCandidates(symbol) {
            guard let url = URL(string: "https://query1.finance.yahoo.com/v8/finance/chart/\(candidate)?interval=1d&range=5d") else {
                continue
            }
            var request = URLRequest(url: url)
            request.setValue("Mozilla/5.0", forHTTPHeaderField: "User-Agent")
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse, http.statusCode == 200 else { continue }
            guard let payload = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let chart = payload["chart"] as? [String: Any],
                  let result = (chart["result"] as? [[String: Any]])?.first,
                  let meta = result["meta"] as? [String: Any] else {
                continue
            }
            let price = (meta["regularMarketPrice"] as? Double)
                ?? (meta["previousClose"] as? Double)
                ?? 0
            guard price > 0 else { continue }
            let currency = (meta["currency"] as? String)
                ?? preferredCurrency
                ?? inferCurrency(from: symbol)
            let asOf = Date(timeIntervalSince1970: (meta["regularMarketTime"] as? Double) ?? Date().timeIntervalSince1970)
            return (price, currency.uppercased(), asOf)
        }
        return nil
    }

    @MainActor
    private static func upsertQuote(symbol: String, quote: (price: Double, currency: String, asOf: Date), context: ModelContext) {
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
            let currency = tx.currency.uppercased()
            counts[symbol, default: [:]][currency, default: 0] += 1
        }
        return counts.mapValues { $0.max(by: { $0.value < $1.value })?.key ?? "PLN" }
    }

    static func yahooCandidates(_ symbol: String) -> [String] {
        let upper = symbol.uppercased()
        if upper.hasPrefix("^") {
            let base = String(upper.dropFirst())
            return unique([base, "\(base).WA", "\(base)TR.WA", upper])
        }
        let parts = upper.split(separator: ".", maxSplits: 1).map(String.init)
        let base = parts.first ?? upper
        let suffix = parts.count > 1 ? parts[1] : ""
        switch suffix {
        case "US":
            return unique([base, upper])
        case "PL":
            return unique(["\(base).WA", base, upper, "ETF\(base)TR.WA", "ETFB\(base)TR.WA"])
        case "WA":
            return unique([upper, base])
        case "UK":
            return unique(["\(base).L", upper])
        case "DE", "FR":
            return unique([upper, base])
        default:
            return unique([upper, "\(base).WA", base])
        }
    }

    private static func inferCurrency(from symbol: String) -> String {
        let suffix = symbol.uppercased().split(separator: ".").dropFirst().first.map(String.init) ?? ""
        switch suffix {
        case "PL", "WA", "": return "PLN"
        case "DE", "FR": return "EUR"
        case "UK", "L", "US": return "USD"
        default: return "PLN"
        }
    }

    private static func unique(_ values: [String]) -> [String] {
        Array(Set(values.filter { !$0.isEmpty }))
    }
}
