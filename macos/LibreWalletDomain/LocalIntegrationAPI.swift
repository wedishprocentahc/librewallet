import Foundation

/// JSON payloads matching `server.js` `/api/holdings` + `/api/portfolio` for OpenClaw / Inwestor.
enum LocalIntegrationAPI {
    struct Instrument: Encodable, Equatable {
        let symbol: String
        let name: String
        let currency: String
        let assetType: String
        let market: String
        let portfolioName: String
    }

    struct HoldingsResponse: Encodable, Equatable {
        let instruments: [Instrument]
        let updatedAt: String
        let portfolioCount: Int
    }

    struct PortfolioSummary: Encodable, Equatable {
        let totalValue: Double
        let netInvested: Double
        let totalProfit: Double
        let returnPct: Double
        let baseCurrency: String
        let cashByCurrency: [String: Double]
        let allocationByType: [String: Double]
        let allocationByCurrency: [String: Double]
        let fetchedAt: String
    }

    struct PortfolioResponse: Encodable {
        let status: String
        let summary: PortfolioSummary?
        let holdings: HoldingsResponse?
        let message: String?

        static func ok(summary: PortfolioSummary, holdings: HoldingsResponse) -> PortfolioResponse {
            PortfolioResponse(status: "ok", summary: summary, holdings: holdings, message: nil)
        }

        static func noData(_ message: String) -> PortfolioResponse {
            PortfolioResponse(status: "no_data", summary: nil, holdings: nil, message: message)
        }
    }

    static func holdings(
        portfolios: [Portfolio],
        transactions: [Transaction],
        now: Date = Date()
    ) -> HoldingsResponse {
        var positions: [String: (symbol: String, name: String, currency: String, assetType: String, portfolioName: String, quantity: Double)] = [:]

        for tx in transactions {
            let symbol = (tx.symbol ?? "").trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
            guard !symbol.isEmpty, !SymbolResolver.isIgnored(symbol) else { continue }
            let currency = CurrencyCode.normalize(tx.currency)
            let portfolioId = tx.portfolio?.id.uuidString ?? "-"
            let key = "\(portfolioId)|\(symbol)|\(currency)"
            if positions[key] == nil {
                positions[key] = (
                    symbol: symbol,
                    name: tx.name ?? symbol,
                    currency: currency,
                    assetType: tx.assetType ?? AssetTypeDetection.detect(symbol: tx.symbol, name: tx.name),
                    portfolioName: tx.portfolio?.name ?? "",
                    quantity: 0
                )
            }
            guard var pos = positions[key] else { continue }
            if let name = tx.name, !name.isEmpty { pos.name = name }
            switch tx.type {
            case .buy:
                pos.quantity += abs(tx.quantity ?? 0)
            case .sell:
                pos.quantity -= abs(tx.quantity ?? 0)
            default:
                break
            }
            positions[key] = pos
        }

        let instruments: [Instrument] = positions.values
            .filter { $0.quantity > 0.0000001 }
            .map { pos in
                let market = inferMarket(pos.symbol)
                return Instrument(
                    symbol: formatInstrumentSymbol(pos.symbol, market: market),
                    name: pos.name,
                    currency: pos.currency,
                    assetType: pos.assetType,
                    market: market,
                    portfolioName: pos.portfolioName
                )
            }
            .sorted { $0.symbol < $1.symbol }

        return HoldingsResponse(
            instruments: instruments,
            updatedAt: iso8601(now),
            portfolioCount: portfolios.count
        )
    }

    static func portfolioSummary(
        portfolios: [Portfolio],
        transactions: [Transaction],
        quotes: [Quote],
        ratesToPLN: [String: Double],
        now: Date = Date()
    ) -> PortfolioSummary {
        let scope: ScopeResult
        if portfolios.count == 1, let portfolio = portfolios.first {
            scope = PortfolioCalculator.calculate(
                portfolio: portfolio,
                allTransactions: transactions,
                quotes: quotes,
                ratesToPLN: ratesToPLN
            )
        } else {
            scope = PortfolioCalculator.aggregateToPLN(
                portfolios: portfolios,
                allTransactions: transactions,
                quotes: quotes,
                ratesToPLN: ratesToPLN
            )
        }

        let cashByCurrency = Dictionary(
            uniqueKeysWithValues: scope.cashRows
                .filter { $0.value > 0.0001 }
                .map { ($0.currency, $0.value) }
        )

        return PortfolioSummary(
            totalValue: scope.totalValueBase,
            netInvested: scope.netInvestedBase,
            totalProfit: scope.totalProfitBase,
            returnPct: scope.returnPct,
            baseCurrency: scope.baseCurrency,
            cashByCurrency: cashByCurrency,
            allocationByType: scope.allocationByType,
            allocationByCurrency: scope.allocationByCurrency,
            fetchedAt: iso8601(now)
        )
    }

    static func inferMarket(_ symbol: String) -> String {
        let suffix = symbol.split(separator: ".").dropFirst().first.map(String.init)?.uppercased() ?? ""
        switch suffix {
        case "PL", "WA": return "GPW"
        case "DE": return "Xetra"
        case "UK", "L": return "LSE"
        case "US": return "NASDAQ"
        default: return ""
        }
    }

    static func formatInstrumentSymbol(_ symbol: String, market: String) -> String {
        let parts = symbol.split(separator: ".", maxSplits: 1).map(String.init)
        let base = parts.first ?? symbol
        switch market {
        case "GPW":
            return "\(base).PL"
        case "Xetra":
            return symbol.hasSuffix(".DE") ? symbol : "\(symbol).DE"
        case "LSE":
            return symbol.hasSuffix(".UK") ? symbol : "\(symbol).UK"
        case "NASDAQ":
            return symbol.hasSuffix(".US") ? symbol : "\(symbol).US"
        default:
            return symbol
        }
    }

    private static func iso8601(_ date: Date) -> String {
        ISO8601DateFormatter().string(from: date)
    }
}
