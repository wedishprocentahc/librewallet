import Foundation
import SwiftData

/// Rich snapshot for OpenClaw / Inwestor (`agent-feed.json` + `GET /api/agent-feed`).
enum AgentFeedBuilder {
    static let schemaVersion = 1
    static let source = "librewallet-native"
    static let staleQuoteHours: Double = 36

    struct Feed: Encodable, Equatable {
        let schemaVersion: Int
        let generatedAt: String
        let appVersion: String
        let baseCurrency: String
        let source: String
        let lastSyncAt: String?

        let totalValue: Double
        let netInvested: Double
        let totalProfit: Double
        let returnPct: Double
        let allocationByType: [String: Double]
        let allocationByCurrency: [String: Double]

        let positions: [Position]
        let cash: [Cash]

        let quotesAgeMinutes: Int?
        let staleSymbols: [String]
        let missingQuotes: [String]
    }

    struct Position: Encodable, Equatable {
        let symbol: String
        let name: String
        let market: String
        let currency: String
        let assetType: String
        let portfolioId: String?
        let portfolioName: String
        let quantity: Double
        let avgCost: Double
        let invested: Double
        let currentPrice: Double
        let priceAsOf: String?
        let currentValue: Double
        let valueBase: Double
        let profit: Double
        let profitPct: Double
        let realized: Double
        let income: Double
        let weightPct: Double
    }

    struct Cash: Encodable, Equatable {
        let currency: String
        let portfolioId: String?
        let portfolioName: String
        let value: Double
        let valueBase: Double
    }

    static func build(
        portfolios: [Portfolio],
        transactions: [Transaction],
        quotes: [Quote],
        ratesToPLN: [String: Double],
        appVersion: String,
        now: Date = Date()
    ) -> Feed {
        let quoteBySymbol = Dictionary(uniqueKeysWithValues: quotes.map { ($0.symbol.uppercased(), $0) })
        let aggregate = PortfolioCalculator.aggregateToPLN(
            portfolios: portfolios,
            allTransactions: transactions,
            quotes: quotes,
            ratesToPLN: ratesToPLN
        )

        var positions: [Position] = []
        var cash: [Cash] = []
        var missingQuotes: [String] = []
        var staleSymbols: [String] = []
        var newestQuote: Date?

        for portfolio in portfolios {
            let scope = PortfolioCalculator.calculate(
                portfolio: portfolio,
                allTransactions: transactions,
                quotes: quotes,
                ratesToPLN: ratesToPLN
            )

            for row in scope.cashRows where row.value > 0.0001 {
                cash.append(
                    Cash(
                        currency: row.currency,
                        portfolioId: portfolio.id.uuidString,
                        portfolioName: portfolio.name,
                        value: roundMoney(row.value),
                        valueBase: roundMoney(
                            PortfolioCalculator.convertToPLN(row.value, currency: row.currency, rates: ratesToPLN)
                        )
                    )
                )
            }

            for row in scope.positions where abs(row.quantity) > 0.0000001 {
                let market = LocalIntegrationAPI.inferMarket(row.symbol)
                let symbolOut = LocalIntegrationAPI.formatInstrumentSymbol(row.symbol, market: market)
                let valueBase = PortfolioCalculator.convertToPLN(
                    max(0, row.currentValue),
                    currency: row.currency,
                    rates: ratesToPLN
                )
                let profitPct = row.invested > 0.0001 ? (row.profit / row.invested) * 100 : 0
                let weightPct = aggregate.totalValueBase > 0.0001
                    ? (valueBase / aggregate.totalValueBase) * 100
                    : 0

                let quote = quoteBySymbol[row.symbol.uppercased()]
                let priceAsOf = quote.map { iso8601($0.asOf) }
                if let quote {
                    newestQuote = max(newestQuote ?? quote.asOf, quote.asOf)
                    let ageHours = now.timeIntervalSince(quote.asOf) / 3600
                    if ageHours > staleQuoteHours {
                        staleSymbols.append(symbolOut)
                    }
                } else if row.assetType != "bond" {
                    missingQuotes.append(symbolOut)
                }

                positions.append(
                    Position(
                        symbol: symbolOut,
                        name: row.name,
                        market: market,
                        currency: row.currency,
                        assetType: row.assetType,
                        portfolioId: portfolio.id.uuidString,
                        portfolioName: portfolio.name,
                        quantity: roundQty(row.quantity),
                        avgCost: roundMoney(row.avgCost),
                        invested: roundMoney(row.invested),
                        currentPrice: roundMoney(row.currentPrice),
                        priceAsOf: priceAsOf,
                        currentValue: roundMoney(row.currentValue),
                        valueBase: roundMoney(valueBase),
                        profit: roundMoney(row.profit),
                        profitPct: roundPct(profitPct),
                        realized: roundMoney(row.realized),
                        income: roundMoney(row.income),
                        weightPct: roundPct(weightPct)
                    )
                )
            }
        }

        positions.sort {
            if $0.valueBase != $1.valueBase { return $0.valueBase > $1.valueBase }
            return $0.symbol < $1.symbol
        }
        cash.sort {
            if $0.portfolioName != $1.portfolioName { return $0.portfolioName < $1.portfolioName }
            return $0.currency < $1.currency
        }

        let quotesAgeMinutes: Int?
        if let newestQuote {
            quotesAgeMinutes = max(0, Int(now.timeIntervalSince(newestQuote) / 60))
        } else {
            quotesAgeMinutes = nil
        }

        return Feed(
            schemaVersion: schemaVersion,
            generatedAt: iso8601(now),
            appVersion: appVersion,
            baseCurrency: "PLN",
            source: source,
            lastSyncAt: newestQuote.map(iso8601),
            totalValue: roundMoney(aggregate.totalValueBase),
            netInvested: roundMoney(aggregate.netInvestedBase),
            totalProfit: roundMoney(aggregate.totalProfitBase),
            returnPct: roundPct(aggregate.returnPct),
            allocationByType: roundMap(aggregate.allocationByType),
            allocationByCurrency: roundMap(aggregate.allocationByCurrency),
            positions: positions,
            cash: cash,
            quotesAgeMinutes: quotesAgeMinutes,
            staleSymbols: Array(Set(staleSymbols)).sorted(),
            missingQuotes: Array(Set(missingQuotes)).sorted()
        )
    }

    private static func iso8601(_ date: Date) -> String {
        ISO8601DateFormatter().string(from: date)
    }

    private static func roundMoney(_ value: Double) -> Double {
        (value * 100).rounded() / 100
    }

    private static func roundQty(_ value: Double) -> Double {
        (value * 1_000_000).rounded() / 1_000_000
    }

    private static func roundPct(_ value: Double) -> Double {
        (value * 100).rounded() / 100
    }

    private static func roundMap(_ map: [String: Double]) -> [String: Double] {
        Dictionary(uniqueKeysWithValues: map.map { ($0.key, roundMoney($0.value)) })
    }
}

enum AgentFeedStore {
    static var fileURL: URL {
        let appSupport = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        let dir = appSupport.appendingPathComponent("LibreWallet", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent("agent-feed.json")
    }

    static func write(_ feed: AgentFeedBuilder.Feed) throws {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        let data = try encoder.encode(feed)
        let dest = fileURL
        let tmp = dest.appendingPathExtension("tmp")
        if FileManager.default.fileExists(atPath: tmp.path) {
            try? FileManager.default.removeItem(at: tmp)
        }
        try data.write(to: tmp, options: .atomic)
        if FileManager.default.fileExists(atPath: dest.path) {
            try FileManager.default.removeItem(at: dest)
        }
        try FileManager.default.moveItem(at: tmp, to: dest)
    }

    static func readData() -> Data? {
        try? Data(contentsOf: fileURL)
    }
}

@MainActor
enum AgentFeedPublisher {
    private static var debounceTask: Task<Void, Never>?
    private static weak var container: ModelContainer?
    private static var saveObserver: NSObjectProtocol?

    static func configure(container: ModelContainer) {
        self.container = container
        if let saveObserver {
            NotificationCenter.default.removeObserver(saveObserver)
        }
        saveObserver = NotificationCenter.default.addObserver(
            forName: ModelContext.didSave,
            object: nil,
            queue: .main
        ) { _ in
            Task { @MainActor in
                schedulePublish()
            }
        }
        publishNow()
    }

    static func schedulePublish() {
        debounceTask?.cancel()
        debounceTask = Task {
            try? await Task.sleep(nanoseconds: 300_000_000)
            guard !Task.isCancelled else { return }
            publishNow()
        }
    }

    @discardableResult
    static func publishNow() -> AgentFeedBuilder.Feed? {
        guard let container else { return nil }
        let context = ModelContext(container)
        do {
            let portfolios = try context.fetch(FetchDescriptor<Portfolio>(sortBy: [SortDescriptor(\.createdAt)]))
            let transactions = try context.fetch(FetchDescriptor<Transaction>())
            let quotes = try context.fetch(FetchDescriptor<Quote>())
            let rates = NBPExchangeRateService.cachedRatesToPLN()
            let feed = AgentFeedBuilder.build(
                portfolios: portfolios,
                transactions: transactions,
                quotes: quotes,
                ratesToPLN: rates,
                appVersion: AppVersion.shortVersion
            )
            try AgentFeedStore.write(feed)
            return feed
        } catch {
            print("AgentFeed publish failed: \(error)")
            return nil
        }
    }
}
