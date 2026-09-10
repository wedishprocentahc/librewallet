import Foundation

struct ScopeResult {
    let baseCurrency: String
    let transactions: [Transaction]
    let hasCashOperations: Bool

    let positions: [PositionRow]
    let cashRows: [CashRow]

    let totalValueBase: Double
    let positionValueBase: Double
    let cashValueBase: Double

    let totalProfitBase: Double
    let netInvestedBase: Double
    let returnPct: Double

    let allocationByType: [String: Double]
    let allocationByCurrency: [String: Double]
}

struct PositionRow: Identifiable, Hashable {
    let id: String
    let symbol: String
    let name: String
    let currency: String
    let assetType: String
    let portfolioId: UUID?
    let portfolioName: String
    let groupId: UUID?
    let groupName: String

    let quantity: Double
    let avgCost: Double
    let invested: Double

    let currentPrice: Double
    let currentValue: Double

    let profit: Double
    let realized: Double
    let income: Double
    var totalProfit: Double { profit + realized + income }
}

struct CashRow: Identifiable, Hashable {
    let id: String
    let currency: String
    let value: Double
}

struct HistoryRow: Identifiable, Hashable {
    var id: String { dayKey }
    let date: Date
    let dayKey: String
    let value: Double
    let invested: Double
    let positions: Double
    let cash: Double
}

enum PortfolioCalculator {
    static func calculate(
        portfolio: Portfolio?,
        allTransactions: [Transaction],
        quotes: [Quote],
        includeCashInAllocation: Bool = true,
        ratesToPLN: [String: Double] = NBPExchangeRateService.cachedRatesToPLN()
    ) -> ScopeResult {
        let baseCurrency = CurrencyCode.normalize(portfolio?.baseCurrency)
        let scoped = allTransactions
            .filter { tx in
                guard let portfolio else { return true }
                return tx.portfolio?.id == portfolio.id
            }
            .sorted { $0.date < $1.date }

        let hasCashOperations = scoped.contains {
            ["deposit", "withdrawal", "transfer"].contains($0.typeRaw)
        }

        var positions: [String: PositionAccumulator] = [:]
        var cash: [String: Double] = [:]

        let quoteBySymbol: [String: Quote] = Dictionary(uniqueKeysWithValues: quotes.map { ($0.symbol.uppercased(), $0) })
        let quoteMap: [String: Quote] = Dictionary(uniqueKeysWithValues: quotes.map { ("\($0.symbol.uppercased())|\($0.currency.uppercased())", $0) })

        var netInvested: Double = 0
        var explicitCashFlow: Double = 0

        for tx in scoped {
            let norm = normalizeTransaction(tx)
            applyTransaction(norm, positions: &positions, cash: &cash)

            if hasCashOperations {
                switch norm.type {
                case .deposit:
                    explicitCashFlow += norm.cashDelta ?? norm.gross
                case .withdrawal:
                    explicitCashFlow += norm.cashDelta ?? -norm.gross
                case .transfer:
                    explicitCashFlow += norm.cashDelta ?? 0
                default:
                    break
                }
            } else {
                if norm.type == .buy { netInvested += norm.gross + norm.fee }
                if norm.type == .sell { netInvested -= max(0, norm.gross - norm.fee) }
                if norm.type == .dividend || norm.type == .interest {
                    netInvested -= max(0, norm.gross - norm.fee)
                }
            }
        }

        // Summarize positions with prices
        let positionRows: [PositionRow] = positions.values
            .compactMap { acc -> PositionRow? in
                // Yahoo vs XTB mismatch for this ticker — ignore in valuation (web parity).
                if IgnoredSymbols.contains(acc.symbol) {
                    return nil
                }
                let invested = acc.invested
                let price: Double
                let currentValue: Double
                if let bondValue = bondMarkValue(acc, asOf: Date()) {
                    currentValue = bondValue
                    price = abs(acc.quantity) > 0.0000001 ? bondValue / acc.quantity : 0
                } else {
                    let q = quoteMap["\(acc.symbol)|\(acc.currency)"] ?? quoteBySymbol[acc.symbol.uppercased()]
                    price = markPrice(for: acc, quote: q, ratesToPLN: ratesToPLN)
                    currentValue = acc.quantity * price
                }
                let profit = currentValue - invested
                let pid = portfolio?.id
                return PositionRow(
                    id: "\(pid?.uuidString ?? "all")|\(acc.symbol)|\(acc.currency)",
                    symbol: acc.symbol,
                    name: acc.name,
                    currency: acc.currency,
                    assetType: acc.assetType,
                    portfolioId: pid,
                    portfolioName: portfolio?.name ?? "",
                    groupId: portfolio?.group?.id,
                    groupName: portfolio?.group?.name ?? "",
                    quantity: acc.quantity,
                    avgCost: acc.quantity != 0 ? invested / acc.quantity : 0,
                    invested: invested,
                    currentPrice: price,
                    currentValue: currentValue,
                    profit: profit,
                    realized: acc.realized,
                    income: acc.income
                )
            }
            .filter { abs($0.quantity) > 0.0000001 || abs($0.totalProfit) > 0.0001 }
            .sorted { $0.symbol < $1.symbol }

        // JS parity: expose cash only when we have explicit cash operations.
        // Manual bond portfolios (buys without deposits) must not emit a large negative cash
        // row — otherwise aggregateToPLN merges it into PLN and hides real free funds.
        let includeCashInValue = hasCashOperations
        let cashRows: [CashRow] = includeCashInValue
            ? cash
                .map { (currency, value) in CashRow(id: currency, currency: currency, value: value) }
                .sorted { $0.currency < $1.currency }
            : []

        let positionValueBase = positionRows.reduce(0) { $0 + max(0, $1.currentValue) }
        let cashValueBase = cashRows.reduce(0) { $0 + $1.value }
        let totalValueBase = positionValueBase + cashValueBase

        let openPositionCost = positionRows
            .filter { abs($0.quantity) > 0.0000001 }
            .reduce(0.0) { $0 + $1.invested }

        // JS parity:
        // - netInvestedBase = investedTracker.value()
        // - totalProfitBase = sum(position.totalProfit) across profitPositions (includes realized + income)
        let investedBase: Double = hasCashOperations ? explicitCashFlow : max(0, netInvested)

        let profitBase = positionRows
            .filter { abs($0.quantity) > 0.0000001 || abs($0.totalProfit) > 0.0001 }
            .reduce(0.0) { $0 + $1.totalProfit }
        let returnPct = investedBase > 0 ? (profitBase / investedBase) * 100 : 0

        var allocationByType: [String: Double] = [:]
        var allocationByCurrency: [String: Double] = [:]
        for p in positionRows where p.currentValue > 0 {
            allocationByType[p.assetType, default: 0] += p.currentValue
            allocationByCurrency[p.currency, default: 0] += p.currentValue
        }
        if includeCashInAllocation, includeCashInValue {
            for c in cashRows where c.value > 0 {
                allocationByType["cash", default: 0] += c.value
                allocationByCurrency[c.currency, default: 0] += c.value
            }
        }

        return ScopeResult(
            baseCurrency: baseCurrency,
            transactions: scoped,
            hasCashOperations: hasCashOperations,
            positions: positionRows,
            cashRows: cashRows,
            totalValueBase: totalValueBase,
            positionValueBase: positionValueBase,
            cashValueBase: cashValueBase,
            totalProfitBase: profitBase,
            netInvestedBase: investedBase,
            returnPct: returnPct,
            allocationByType: allocationByType,
            allocationByCurrency: allocationByCurrency
        )
    }

    /// Sums per-portfolio scopes after converting each portfolio's totals to PLN.
    static func aggregateToPLN(
        portfolios: [Portfolio],
        allTransactions: [Transaction],
        quotes: [Quote],
        ratesToPLN: [String: Double]
    ) -> ScopeResult {
        guard !portfolios.isEmpty else {
            return ScopeResult(
                baseCurrency: "PLN",
                transactions: [],
                hasCashOperations: false,
                positions: [],
                cashRows: [],
                totalValueBase: 0,
                positionValueBase: 0,
                cashValueBase: 0,
                totalProfitBase: 0,
                netInvestedBase: 0,
                returnPct: 0,
                allocationByType: [:],
                allocationByCurrency: [:]
            )
        }

        var totalValuePLN = 0.0
        var totalProfitPLN = 0.0
        var netInvestedPLN = 0.0
        var positionValuePLN = 0.0
        var cashValuePLN = 0.0
        var allPositions: [PositionRow] = []
        var mergedCash: [String: Double] = [:]
        var allTransactionsOut: [Transaction] = []
        var hasCashOperations = false
        var allocationByType: [String: Double] = [:]
        var allocationByCurrency: [String: Double] = [:]

        for portfolio in portfolios {
            let scoped = allTransactions.filter { $0.portfolio?.id == portfolio.id }
            let scope = calculate(
                portfolio: portfolio,
                allTransactions: scoped,
                quotes: quotes,
                ratesToPLN: ratesToPLN
            )
            let base = scope.baseCurrency.uppercased()

            totalValuePLN += convertToPLN(scope.totalValueBase, currency: base, rates: ratesToPLN)
            netInvestedPLN += convertToPLN(scope.netInvestedBase, currency: base, rates: ratesToPLN)
            totalProfitPLN += convertToPLN(scope.totalProfitBase, currency: base, rates: ratesToPLN)
            positionValuePLN += convertToPLN(scope.positionValueBase, currency: base, rates: ratesToPLN)

            allPositions.append(contentsOf: scope.positions)
            if scope.hasCashOperations {
                cashValuePLN += convertToPLN(scope.cashValueBase, currency: base, rates: ratesToPLN)
                for row in scope.cashRows {
                    mergedCash[row.currency, default: 0] += row.value
                }
            }
            allTransactionsOut.append(contentsOf: scope.transactions)
            hasCashOperations = hasCashOperations || scope.hasCashOperations
        }

        for position in allPositions where position.currentValue > 0 {
            let valuePLN = convertToPLN(position.currentValue, currency: position.currency, rates: ratesToPLN)
            allocationByType[position.assetType, default: 0] += valuePLN
            allocationByCurrency[position.currency, default: 0] += valuePLN
        }
        for (currency, value) in mergedCash where value > 0 {
            let valuePLN = convertToPLN(value, currency: currency, rates: ratesToPLN)
            allocationByType["cash", default: 0] += valuePLN
            allocationByCurrency[currency, default: 0] += valuePLN
        }

        let cashRows = mergedCash
            .map { CashRow(id: $0.key, currency: $0.key, value: $0.value) }
            .sorted { $0.currency < $1.currency }

        let returnPct = netInvestedPLN > 0 ? (totalProfitPLN / netInvestedPLN) * 100 : 0

        return ScopeResult(
            baseCurrency: "PLN",
            transactions: allTransactionsOut.sorted { $0.date < $1.date },
            hasCashOperations: hasCashOperations,
            positions: allPositions.sorted { $0.symbol < $1.symbol },
            cashRows: cashRows,
            totalValueBase: totalValuePLN,
            positionValueBase: positionValuePLN,
            cashValueBase: cashValuePLN,
            totalProfitBase: totalProfitPLN,
            netInvestedBase: netInvestedPLN,
            returnPct: returnPct,
            allocationByType: allocationByType,
            allocationByCurrency: allocationByCurrency
        )
    }

    static func buildDailyTimeline(
        portfolio: Portfolio?,
        allTransactions: [Transaction],
        quotes: [Quote],
        histories: [String: [(date: Date, close: Double)]] = [:]
    ) -> [HistoryRow] {
        let scoped = allTransactions
            .filter { tx in
                guard let portfolio else { return true }
                return tx.portfolio?.id == portfolio.id
            }
            .sorted { $0.date < $1.date }

        guard let first = scoped.first else { return [] }

        let hasCashOperations = scoped.contains { ["deposit", "withdrawal", "transfer"].contains($0.typeRaw) }

        var positions: [String: PositionAccumulator] = [:]
        var cash: [String: Double] = [:]
        var netInvested: Double = 0
        var explicitCashFlow: Double = 0

        let quoteBySymbol: [String: Quote] = Dictionary(uniqueKeysWithValues: quotes.map { ($0.symbol.uppercased(), $0) })
        let quoteMap: [String: Quote] = Dictionary(uniqueKeysWithValues: quotes.map { ("\($0.symbol.uppercased())|\($0.currency.uppercased())", $0) })

        let cal = Calendar.current
        let df = DateFormatter()
        df.locale = Locale(identifier: "en_US_POSIX")
        df.dateFormat = "yyyy-MM-dd"

        // Pre-sort historical price series (ascending) per uppercased symbol for fast lookup.
        // Normalize to calendar day boundaries so trade timestamps and quote dates align.
        let sortedHistories: [String: [(date: Date, close: Double)]] = histories.mapValues { points in
            var byDay: [Date: Double] = [:]
            for point in points where point.close > 0 {
                let day = cal.startOfDay(for: point.date)
                byDay[day] = point.close
            }
            return byDay
                .map { (date: $0.key, close: $0.value) }
                .sorted { $0.date < $1.date }
        }

        let startDay = cal.startOfDay(for: first.date)
        let endDay = cal.startOfDay(for: Date())

        var out: [HistoryRow] = []
        var idx = 0
        // Pointer-walk indices for O(1) amortized historical price lookup per day.
        var dayHistoryIndices: [String: Int] = [:]
        var anchorCloses: [String: (tradeDate: Date, close: Double)] = [:]

        var day = startDay
        while day <= endDay {
            while idx < scoped.count {
                let tx = scoped[idx]
                let txDay = cal.startOfDay(for: tx.date)
                guard txDay <= day else { break }
                let norm = normalizeTransaction(tx)
                applyTransaction(norm, positions: &positions, cash: &cash)

                if hasCashOperations {
                    switch norm.type {
                    case .deposit:
                        explicitCashFlow += norm.cashDelta ?? norm.gross
                    case .withdrawal:
                        explicitCashFlow += norm.cashDelta ?? -norm.gross
                    case .transfer:
                        explicitCashFlow += norm.cashDelta ?? 0
                    default:
                        break
                    }
                } else {
                    if norm.type == .buy { netInvested += norm.gross + norm.fee }
                    if norm.type == .sell { netInvested -= max(0, norm.gross - norm.fee) }
                    if norm.type == .dividend || norm.type == .interest {
                        netInvested -= max(0, norm.gross - norm.fee)
                    }
                }

                idx += 1
            }

            // Each historical day is valued at the market price for that day, matching the
            // pre-migration web chart. Trades are recorded in the account currency (e.g. PLN),
            // while price history is in the instrument's native currency, so we scale the
            // account-currency cost basis (`lastPrice`) by the native market performance since
            // the last trade: value = qty * lastPrice * close(day) / close(lastTradeDate).
            // This keeps the result in the account currency (FX at trade time stays embedded)
            // and lets the value line float above/below contributions like real market value.
            let isLatestDay = day == endDay
            var positionsValue = 0.0
            for acc in positions.values where abs(acc.quantity) > 0.0000001 {
                if IgnoredSymbols.contains(acc.symbol) {
                    continue
                }
                if let bondValue = bondMarkValue(acc, asOf: day) {
                    positionsValue += max(0, bondValue)
                    continue
                }

                let avgCost = acc.invested / acc.quantity
                var price = avgCost > 0 ? avgCost : (acc.lastPrice ?? 0)
                let symbolKey = acc.symbol.uppercased()

                if let series = sortedHistories[symbolKey],
                   let anchorDate = acc.lastTradeDate,
                   price > 0 {
                    let tradeDay = cal.startOfDay(for: anchorDate)
                    if anchorCloses[symbolKey]?.tradeDate != tradeDay {
                        var anchorIndex = 0
                        let anchorClose = closeAtOrBefore(series, date: tradeDay, index: &anchorIndex) ?? 0
                        anchorCloses[symbolKey] = (tradeDay, anchorClose)
                        dayHistoryIndices[symbolKey] = anchorIndex
                    }

                    let anchorClose = anchorCloses[symbolKey]?.close ?? 0
                    // On the trade day itself keep cost-basis valuation (ratio = 1) to avoid
                    // one-day dips from timestamp / quote-alignment mismatches.
                    if day != tradeDay, anchorClose > 0 {
                        var dayIndex = dayHistoryIndices[symbolKey] ?? 0
                        let dayClose = closeAtOrBefore(series, date: day, index: &dayIndex) ?? 0
                        dayHistoryIndices[symbolKey] = dayIndex
                        if dayClose > 0 {
                            price = price * (dayClose / anchorClose)
                        }
                    }
                } else if isLatestDay {
                    let q = quoteMap["\(acc.symbol)|\(acc.currency)"] ?? quoteBySymbol[acc.symbol.uppercased()]
                    price = markPrice(
                        for: acc,
                        quote: q,
                        ratesToPLN: NBPExchangeRateService.cachedRatesToPLN()
                    )
                }

                positionsValue += max(0, acc.quantity * price)
            }

            let cashValue = hasCashOperations ? cash.values.reduce(0, +) : 0
            let totalValue = positionsValue + cashValue
            let invested = hasCashOperations ? explicitCashFlow : max(0, netInvested)

            out.append(
                HistoryRow(
                    date: day,
                    dayKey: df.string(from: day),
                    value: totalValue,
                    invested: invested,
                    positions: positionsValue,
                    cash: cashValue
                )
            )

            guard let next = cal.date(byAdding: .day, value: 1, to: day) else { break }
            day = next
        }

        return out
    }

    /// Returns the most recent close on or before `date` (series must be sorted ascending, day-normalized).
    private static func closeAtOrBefore(
        _ series: [(date: Date, close: Double)],
        date: Date,
        index: inout Int
    ) -> Double? {
        guard !series.isEmpty else { return nil }
        let target = Calendar.current.startOfDay(for: date)
        if index < 0 { index = 0 }
        if index >= series.count { index = series.count - 1 }

        while (index + 1) < series.count, series[index + 1].date <= target {
            index += 1
        }
        if series[index].date > target {
            index = 0
        }
        return series[index].close
    }

    static func aggregateDailyTimelineToPLN(
        portfolios: [Portfolio],
        allTransactions: [Transaction],
        quotes: [Quote],
        ratesToPLN: [String: Double],
        histories: [String: [(date: Date, close: Double)]] = [:]
    ) -> [HistoryRow] {
        guard !portfolios.isEmpty else { return [] }

        var merged: [String: (date: Date, value: Double, invested: Double, positions: Double, cash: Double)] = [:]

        for p in portfolios {
            let rows = buildDailyTimeline(portfolio: p, allTransactions: allTransactions, quotes: quotes, histories: histories)
            for r in rows {
                let key = r.dayKey
                let valuePLN = convertToPLN(r.value, currency: p.baseCurrency, rates: ratesToPLN)
                let investedPLN = convertToPLN(r.invested, currency: p.baseCurrency, rates: ratesToPLN)
                let positionsPLN = convertToPLN(r.positions, currency: p.baseCurrency, rates: ratesToPLN)
                let cashPLN = convertToPLN(r.cash, currency: p.baseCurrency, rates: ratesToPLN)
                if let existing = merged[key] {
                    merged[key] = (
                        date: existing.date,
                        value: existing.value + valuePLN,
                        invested: existing.invested + investedPLN,
                        positions: existing.positions + positionsPLN,
                        cash: existing.cash + cashPLN
                    )
                } else {
                    merged[key] = (date: r.date, value: valuePLN, invested: investedPLN, positions: positionsPLN, cash: cashPLN)
                }
            }
        }

        return merged
            .map { (key, v) in
                HistoryRow(date: v.date, dayKey: key, value: v.value, invested: v.invested, positions: v.positions, cash: v.cash)
            }
            .sorted { $0.date < $1.date }
    }

    static func convertToPLN(_ amount: Double, currency: String, rates: [String: Double]) -> Double {
        NBPExchangeRateService.convertToPLN(amount, currency: currency, rates: rates)
    }

    // Note: quotes in a foreign currency are converted into the position/account currency
    // via NBP mid rates (same approach as the web app). Without a rate we fall back to cost.

    private static func markPrice(
        for acc: PositionAccumulator,
        quote: Quote?,
        ratesToPLN: [String: Double]
    ) -> Double {
        let fallback = acc.lastPrice ?? 0
        guard let quote, quote.price > 0 else { return fallback }

        let quoteCurrency = quote.currency.uppercased()
        let positionCurrency = acc.currency.uppercased()
        if quoteCurrency.isEmpty || quoteCurrency == "N/A" || quoteCurrency == positionCurrency {
            return quote.price
        }
        if let converted = convertPrice(quote.price, from: quoteCurrency, to: positionCurrency, rates: ratesToPLN) {
            return converted
        }
        return fallback
    }

    /// Convert a market price between currencies using PLN as the bridge (NBP table A).
    static func convertPrice(
        _ price: Double,
        from quoteCurrency: String,
        to positionCurrency: String,
        rates: [String: Double]
    ) -> Double? {
        let from = quoteCurrency.uppercased()
        let to = positionCurrency.uppercased()
        if from == to { return price }
        let fromRate = from == "PLN" ? 1.0 : rates[from]
        let toRate = to == "PLN" ? 1.0 : rates[to]
        guard let fromRate, fromRate > 0, let toRate, toRate > 0 else { return nil }
        let pricePLN = price * fromRate
        return pricePLN / toRate
    }

    private static func bondMarkValue(_ acc: PositionAccumulator, asOf: Date) -> Double? {
        guard !acc.bondLots.isEmpty else { return nil }
        return acc.bondLots.reduce(0.0) { partial, lot in
            guard lot.quantity > 0 else { return partial }
            return partial + lot.quantity * BondPricing.currentPrice(
                terms: lot.terms,
                purchaseDate: lot.purchaseDate,
                asOf: asOf
            )
        }
    }

    private static func reduceBondLots(_ lots: inout [BondLot], selling: Double) {
        var remaining = selling
        var next: [BondLot] = []
        for lot in lots {
            guard remaining > 0.0000001 else {
                next.append(lot)
                continue
            }
            if lot.quantity <= remaining + 0.0000001 {
                remaining -= lot.quantity
            } else {
                next.append(BondLot(quantity: lot.quantity - remaining, purchaseDate: lot.purchaseDate, terms: lot.terms))
                remaining = 0
            }
        }
        lots = next
    }

    private struct NormalizedTransaction {
        let transaction: Transaction
        let type: TransactionType
        let quantity: Double
        let price: Double
        let gross: Double
        let fee: Double
        let cashDelta: Double?
    }

    private static func normalizeTransaction(_ tx: Transaction) -> NormalizedTransaction {
        let signedAmount = tx.cashDelta ?? tx.gross
        let type = XTBOperationParsing.resolveType(
            rowType: "",
            sideText: tx.notes ?? "",
            amount: signedAmount,
            symbol: tx.symbol,
            quantity: tx.quantity,
            price: tx.price,
            existingType: tx.type
        )
        let deal = XTBOperationParsing.parseDealComment(tx.notes)
        let quantity = abs(tx.quantity ?? 0) > 0 ? abs(tx.quantity ?? 0) : deal.quantity
        let price = abs(tx.price ?? 0) > 0 ? abs(tx.price ?? 0) : deal.price
        let gross = XTBOperationParsing.grossMagnitude(amount: signedAmount, quantity: quantity, price: price)
        let cashDelta: Double?
        switch type {
        case .deposit, .sell, .dividend, .interest:
            cashDelta = tx.cashDelta ?? (signedAmount >= 0 ? abs(signedAmount) : signedAmount)
        case .withdrawal, .buy, .fee, .tax:
            cashDelta = tx.cashDelta ?? (signedAmount <= 0 ? signedAmount : -abs(signedAmount))
        default:
            cashDelta = tx.cashDelta
        }
        return NormalizedTransaction(
            transaction: tx,
            type: type,
            quantity: quantity,
            price: price,
            gross: gross,
            fee: abs(tx.fee),
            cashDelta: cashDelta
        )
    }

    private static func applyTransaction(_ norm: NormalizedTransaction, positions: inout [String: PositionAccumulator], cash: inout [String: Double]) {
        let tx = norm.transaction
        let currency = tx.currency.uppercased()
        let fee = norm.fee
        let gross = norm.gross

        switch norm.type {
        case .deposit:
            addCash(&cash, currency: currency, delta: norm.cashDelta ?? gross)
            return
        case .withdrawal:
            addCash(&cash, currency: currency, delta: norm.cashDelta ?? -gross)
            return
        case .transfer:
            let delta = norm.cashDelta ?? 0
            if shouldApplyTransfer(notes: tx.notes, cashDelta: delta, portfolioName: tx.portfolio?.name) {
                addCash(&cash, currency: currency, delta: delta)
            }
            return
        default:
            break
        }

        let symbol = (tx.symbol ?? tx.name ?? "").trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        if symbol.isEmpty {
            switch norm.type {
            case .dividend, .interest:
                addCash(&cash, currency: currency, delta: norm.cashDelta ?? (gross - fee))
            case .fee, .tax:
                addCash(&cash, currency: currency, delta: norm.cashDelta ?? -(fee > 0 ? fee : gross))
            default:
                break
            }
            return
        }

        let key = "\(symbol)|\(currency)|\(tx.portfolio?.id.uuidString ?? "-")"
        if positions[key] == nil {
            let detectedType = tx.assetType ?? AssetTypeDetection.detect(symbol: tx.symbol, name: tx.name)
            positions[key] = PositionAccumulator(
                symbol: symbol,
                name: tx.name ?? symbol,
                currency: currency,
                assetType: detectedType
            )
        }
        guard var acc = positions[key] else { return }
        if let name = tx.name, !name.isEmpty { acc.name = name }

        switch norm.type {
        case .buy:
            let qty = norm.quantity
            let value = gross > 0 ? gross : qty * norm.price
            guard qty > 0 || value > 0 else { return }
            let oldQty = acc.quantity
            acc.quantity += qty
            acc.invested += value + fee
            if acc.quantity > 0 {
                let priorCost = oldQty > 0 ? (acc.lastPrice ?? 0) * oldQty : 0
                acc.lastPrice = (priorCost + value) / acc.quantity
            } else if norm.price > 0 {
                acc.lastPrice = norm.price
            }
            acc.lastTradeDate = Calendar.current.startOfDay(for: tx.date)
            if let terms = BondPricing.resolveTerms(
                symbol: tx.symbol,
                name: tx.name,
                notes: tx.notes,
                assetType: tx.assetType ?? acc.assetType
            ), qty > 0 {
                acc.assetType = "bond"
                acc.bondLots.append(BondLot(quantity: qty, purchaseDate: tx.date, terms: terms))
            }
            addCash(&cash, currency: currency, delta: norm.cashDelta ?? -(value + fee))
        case .sell:
            let qty = norm.quantity
            let value = gross > 0 ? gross : qty * abs(norm.price > 0 ? norm.price : (acc.lastPrice ?? 0))
            let avgCost = acc.quantity > 0 ? acc.invested / acc.quantity : 0
            let costSold = avgCost * qty
            if acc.quantity > 0 {
                acc.quantity -= qty
                acc.invested = max(0, acc.invested - costSold)
            } else {
                acc.quantity -= qty
            }
            if abs(acc.quantity) < 0.0000001 {
                acc.quantity = 0
                acc.invested = 0
                acc.lastPrice = nil
                acc.bondLots = []
            } else {
                acc.lastPrice = acc.invested / acc.quantity
                if !acc.bondLots.isEmpty {
                    reduceBondLots(&acc.bondLots, selling: qty)
                }
            }
            acc.realized += value - fee - costSold
            acc.lastTradeDate = Calendar.current.startOfDay(for: tx.date)
            addCash(&cash, currency: currency, delta: norm.cashDelta ?? (value - fee))
        case .dividend, .interest:
            acc.income += gross - fee
            addCash(&cash, currency: currency, delta: norm.cashDelta ?? (gross - fee))
        case .fee, .tax:
            acc.realized -= fee > 0 ? fee : gross
            addCash(&cash, currency: currency, delta: norm.cashDelta ?? -(fee > 0 ? fee : gross))
        default:
            break
        }

        positions[key] = acc
    }

    private static func addCash(_ cash: inout [String: Double], currency: String, delta: Double) {
        cash[currency, default: 0] += delta
    }

    /// XTB Cash Operations often lists both signed legs of an internal transfer on the same
    /// account statement. Keep only the leg whose sign matches this portfolio's role.
    private static func shouldApplyTransfer(notes: String?, cashDelta: Double, portfolioName: String?) -> Bool {
        guard abs(cashDelta) > 0.0000001 else { return true }
        let text = notes ?? ""
        let account = accountId(fromPortfolioName: portfolioName)

        if let match = firstMatch(in: text, pattern: #"Transfer from (\d+) to (\d+)"#) {
            let src = match.0
            let dst = match.1
            if let account {
                if account == src { return cashDelta < 0 }
                if account == dst { return cashDelta > 0 }
            }
            // Unknown account: keep both only if signs differ and we can't decide — prefer outbound/inbound by wording.
            return true
        }

        if let match = firstMatch(in: text, pattern: #"from TA:\s*(\d+)\s*to:\s*(\d+)"#) {
            let src = match.0
            let dst = match.1
            if let account {
                if account == src { return cashDelta < 0 }
                if account == dst { return cashDelta > 0 }
            }
            return true
        }

        if text.range(of: #"Transfer out operation on account with id \d+"#, options: .regularExpression) != nil {
            return cashDelta < 0
        }
        if text.range(of: #"Transfer in operation on account with id \d+"#, options: .regularExpression) != nil {
            return cashDelta > 0
        }
        return true
    }

    private static func accountId(fromPortfolioName name: String?) -> String? {
        guard let name,
              let open = name.lastIndex(of: "("),
              let close = name.lastIndex(of: ")"),
              open < close else { return nil }
        let id = String(name[name.index(after: open)..<close])
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return id.allSatisfy(\.isNumber) ? id : nil
    }

    private static func firstMatch(in text: String, pattern: String) -> (String, String)? {
        guard let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]),
              let match = regex.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)),
              match.numberOfRanges >= 3,
              let r1 = Range(match.range(at: 1), in: text),
              let r2 = Range(match.range(at: 2), in: text) else { return nil }
        return (String(text[r1]), String(text[r2]))
    }
}

private enum IgnoredSymbols {
    /// Delegates to SymbolResolver (EEE and similar Yahoo≠XTB mismatches).
    static func contains(_ symbol: String) -> Bool {
        SymbolResolver.isIgnored(symbol)
    }
}

private struct PositionAccumulator {
    var symbol: String
    var name: String
    var currency: String
    var assetType: String

    var quantity: Double = 0
    var invested: Double = 0
    var realized: Double = 0
    var income: Double = 0
    var lastPrice: Double? = nil
    var lastTradeDate: Date? = nil
    var bondLots: [BondLot] = []
}

