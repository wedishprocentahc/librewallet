import Foundation

enum NBPExchangeRateService {
    private static var cachedRates: [String: Double]?
    private static var cachedAt: Date?

    /// currency → (dayKey yyyy-MM-dd → mid PLN rate), filled by prefetch.
    private static var historicalByCurrency: [String: [String: Double]] = [:]
    private static let historyLock = NSLock()

    /// Mid rates from NBP table A: PLN per 1 unit of foreign currency.
    static func ratesToPLN() async throws -> [String: Double] {
        if let cachedRates, let cachedAt, Calendar.current.isDateInToday(cachedAt) {
            return cachedRates
        }

        guard let url = URL(string: "https://api.nbp.pl/api/exchangerates/tables/A/?format=json") else {
            throw ServiceError.invalidURL
        }

        var request = URLRequest(url: url)
        request.setValue("application/json", forHTTPHeaderField: "Accept")

        let (data, response) = try await URLSession.shared.data(for: request)
        if let http = response as? HTTPURLResponse, http.statusCode != 200 {
            throw ServiceError.httpStatus(http.statusCode)
        }

        let tables = try JSONDecoder().decode([RateTable].self, from: data)
        guard let table = tables.first else {
            throw ServiceError.emptyResponse
        }

        var rates: [String: Double] = ["PLN": 1.0]
        for row in table.rates {
            rates[row.code.uppercased()] = row.mid
        }

        cachedRates = rates
        cachedAt = Date()
        return AppPreferences.mergedRatesToPLN(rates)
    }

    static func convertToPLN(_ amount: Double, currency: String, rates: [String: Double]) -> Double {
        let code = CurrencyCode.normalize(currency)
        if code == "PLN" { return amount }
        guard let rate = rates[code] else { return amount }
        return amount * rate
    }

    static func cachedRatesToPLN() -> [String: Double] {
        AppPreferences.mergedRatesToPLN(cachedRates ?? ["PLN": 1.0])
    }

    /// Invalidate in-memory cache (e.g. after FX override changes).
    static func invalidateCache() {
        cachedRates = nil
        cachedAt = nil
        historyLock.lock()
        historicalByCurrency = [:]
        historyLock.unlock()
    }

    // MARK: - Historical mid rates (table A)

    /// Prefetch NBP mid history for currencies between dates (inclusive). Safe to call often — merges into cache.
    static func prefetchHistoricalRates(
        currencies: [String],
        from: Date,
        to: Date
    ) async {
        let start = min(from, to)
        let end = max(from, to)
        let df = dayFormatter
        let fromKey = df.string(from: start)
        let toKey = df.string(from: end)

        for raw in currencies {
            let code = CurrencyCode.normalize(raw)
            if code == "PLN" { continue }
            if let override = AppPreferences.fxOverrides[code], override > 0 {
                // Synthetic flat history for overrides.
                historyLock.lock()
                historicalByCurrency[code, default: [:]][fromKey] = override
                historyLock.unlock()
                continue
            }
            await fetchAndStoreHistory(currency: code, fromKey: fromKey, toKey: toKey)
        }
    }

    /// PLN mid rate for `currency` on `date` (or last available prior day). Falls back to latest table A cache.
    static func rateToPLN(currency: String, on date: Date) -> Double {
        let code = CurrencyCode.normalize(currency)
        if code == "PLN" { return 1 }
        if let override = AppPreferences.fxOverrides[code], override > 0 { return override }

        let key = dayFormatter.string(from: Calendar.current.startOfDay(for: date))
        historyLock.lock()
        let map = historicalByCurrency[code] ?? [:]
        historyLock.unlock()

        if let exact = map[key] { return exact }
        // Walk back up to 10 calendar days for weekends/holidays.
        let cal = Calendar.current
        var cursor = cal.startOfDay(for: date)
        for _ in 0..<10 {
            guard let prev = cal.date(byAdding: .day, value: -1, to: cursor) else { break }
            cursor = prev
            let k = dayFormatter.string(from: cursor)
            if let rate = map[k] { return rate }
        }

        // Fallback: any known historical rate ≤ date, else current cache.
        let prior = map.keys.sorted().last(where: { $0 <= key }).flatMap { map[$0] }
        if let prior { return prior }
        return cachedRatesToPLN()[code] ?? 0
    }

    /// Convenience closure for TaxReport.
    static func rateOnDateProvider() -> TaxReport.RateOnDate {
        { currency, date in rateToPLN(currency: currency, on: date) }
    }

    private static func fetchAndStoreHistory(currency: String, fromKey: String, toKey: String) async {
        // NBP allows max ~367 days per request — split if needed.
        guard let fromDate = dayFormatter.date(from: fromKey),
              let toDate = dayFormatter.date(from: toKey) else { return }

        var windowStart = fromDate
        let cal = Calendar.current
        while windowStart <= toDate {
            let windowEnd = min(toDate, cal.date(byAdding: .day, value: 365, to: windowStart) ?? toDate)
            let s = dayFormatter.string(from: windowStart)
            let e = dayFormatter.string(from: windowEnd)
            let urlString = "https://api.nbp.pl/api/exchangerates/rates/A/\(currency)/\(s)/\(e)/?format=json"
            guard let url = URL(string: urlString) else { break }

            var request = URLRequest(url: url)
            request.setValue("application/json", forHTTPHeaderField: "Accept")
            if let (data, response) = try? await URLSession.shared.data(for: request),
               let http = response as? HTTPURLResponse,
               http.statusCode == 200,
               let series = try? JSONDecoder().decode(CurrencySeries.self, from: data) {
                historyLock.lock()
                var map = historicalByCurrency[currency] ?? [:]
                for row in series.rates {
                    map[row.effectiveDate] = row.mid
                }
                historicalByCurrency[currency] = map
                historyLock.unlock()
            }
            guard let next = cal.date(byAdding: .day, value: 1, to: windowEnd) else { break }
            windowStart = next
        }
    }

    enum ServiceError: LocalizedError {
        case invalidURL
        case httpStatus(Int)
        case emptyResponse

        var errorDescription: String? {
            switch self {
            case .invalidURL: "Nieprawidłowy adres API NBP."
            case .httpStatus(let code): "API NBP zwróciło błąd HTTP \(code)."
            case .emptyResponse: "API NBP zwróciło pustą odpowiedź."
            }
        }
    }

    private static let dayFormatter: DateFormatter = {
        let df = DateFormatter()
        df.locale = Locale(identifier: "en_US_POSIX")
        df.timeZone = TimeZone(secondsFromGMT: 0)
        df.dateFormat = "yyyy-MM-dd"
        return df
    }()

    private struct RateTable: Decodable {
        let effectiveDate: String
        let rates: [RateRow]
    }

    private struct RateRow: Decodable {
        let code: String
        let mid: Double
    }

    private struct CurrencySeries: Decodable {
        let rates: [DatedRate]
    }

    private struct DatedRate: Decodable {
        let effectiveDate: String
        let mid: Double
    }
}
