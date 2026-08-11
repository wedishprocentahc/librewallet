import Foundation

enum ReturnPeriod: String, CaseIterable, Identifiable {
    case oneMonth = "1M"
    case threeMonths = "3M"
    case sixMonths = "6M"
    case oneYear = "1Y"
    case ytd = "YTD"

    var id: String { rawValue }

    func startDate(asOf: Date = Date(), calendar: Calendar = .current) -> Date {
        let day = calendar.startOfDay(for: asOf)
        switch self {
        case .oneMonth:
            return calendar.date(byAdding: .month, value: -1, to: day) ?? day
        case .threeMonths:
            return calendar.date(byAdding: .month, value: -3, to: day) ?? day
        case .sixMonths:
            return calendar.date(byAdding: .month, value: -6, to: day) ?? day
        case .oneYear:
            return calendar.date(byAdding: .year, value: -1, to: day) ?? day
        case .ytd:
            let comps = calendar.dateComponents([.year], from: day)
            return calendar.date(from: comps) ?? day
        }
    }
}

enum PeriodReturns {
    /// Approximate total return for a position using price history.
    /// Uses last close on/before start and current price. Returns nil if insufficient data.
    static func returnPct(
        symbol: String,
        currentPrice: Double,
        histories: [String: [(date: Date, close: Double)]],
        period: ReturnPeriod,
        asOf: Date = Date()
    ) -> Double? {
        guard currentPrice > 0 else { return nil }
        let key = symbol.uppercased()
        guard let series = histories[key], !series.isEmpty else { return nil }

        let start = period.startDate(asOf: asOf)
        let past = series.filter { $0.date <= start }.last ?? series.first
        guard let past, past.close > 0 else { return nil }
        return ((currentPrice - past.close) / past.close) * 100.0
    }

    static func allReturns(
        symbol: String,
        currentPrice: Double,
        histories: [String: [(date: Date, close: Double)]],
        asOf: Date = Date()
    ) -> [ReturnPeriod: Double] {
        var out: [ReturnPeriod: Double] = [:]
        for period in ReturnPeriod.allCases {
            if let pct = returnPct(symbol: symbol, currentPrice: currentPrice, histories: histories, period: period, asOf: asOf) {
                out[period] = pct
            }
        }
        return out
    }
}
