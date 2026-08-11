import Foundation

/// Tax report for a calendar year (simplified PL investor view — not a filed PIT-38).
struct TaxYearSummary: Hashable {
    let year: Int
    /// Sum of positive sell P&L (report currency).
    let realizedGains: Double
    /// Sum of negative sell P&L (negative number).
    let realizedLosses: Double
    /// Gross sell proceeds (PIT-38-ish „przychód”).
    let capitalProceeds: Double
    /// Cost basis of sold lots (PIT-38-ish „koszty uzyskania”).
    let capitalCosts: Double
    let dividends: Double
    let interest: Double
    /// Informational sum of fee fields (already reflected in cost/proceeds where applicable).
    let fees: Double
    let currency: String
    let includedPortfolioCount: Int
    let excludedTaxExemptCount: Int

    var netCapital: Double { realizedGains + realizedLosses }
    /// Approximate PIT-38 capital result: proceeds − costs (== netCapital when consistent).
    var pit38CapitalIncome: Double { capitalProceeds - capitalCosts }
    var incomeTotal: Double { dividends + interest }
    var estimatedBelkaTax: Double { max(0, netCapital) * 0.19 }
}

struct TaxSellLine: Identifiable, Hashable {
    let id: UUID
    let date: Date
    let symbol: String
    let name: String
    let portfolioName: String
    let quantity: Double
    let proceeds: Double
    let cost: Double
    let pnl: Double
    let currency: String
}

struct TaxIncomeLine: Identifiable, Hashable {
    let id: UUID
    let date: Date
    let kind: String
    let symbol: String
    let portfolioName: String
    let amount: Double
    let currency: String
}

struct TaxYearReport: Hashable {
    let summary: TaxYearSummary
    let sells: [TaxSellLine]
    let incomeLines: [TaxIncomeLine]
}

enum TaxReport {
    /// `(currency, date) -> PLN mid rate` (PLN per 1 unit). PLN → 1.
    typealias RateOnDate = (String, Date) -> Double

    /// Build a year report using FIFO lots from the **full** transaction history
    /// (buys before the year still form cost basis). Amounts converted with `rateOnDate`.
    static func report(
        year: Int,
        transactions: [Transaction],
        portfolios: [Portfolio] = [],
        reportCurrency: String = "PLN",
        includeTaxExemptAccounts: Bool = false,
        portfolioIds: Set<UUID>? = nil,
        rateOnDate: RateOnDate
    ) -> TaxYearReport {
        let cal = Calendar.current
        let reportCcy = reportCurrency.uppercased()
        let portfolioById = Dictionary(uniqueKeysWithValues: portfolios.map { ($0.id, $0) })

        func portfolio(for tx: Transaction) -> Portfolio? {
            guard let p = tx.portfolio else { return nil }
            return portfolioById[p.id] ?? p
        }
        let exemptPortfolioIds = Set(
            portfolios.filter { isTaxExemptAccount($0) }.map(\.id)
        ).union(
            Set(transactions.compactMap { tx -> UUID? in
                guard let p = portfolio(for: tx), isTaxExemptAccount(p) else { return nil }
                return p.id
            })
        )

        let filtered = transactions.filter { tx in
            if let portfolioIds {
                guard let pid = tx.portfolio?.id, portfolioIds.contains(pid) else { return false }
            }
            if !includeTaxExemptAccounts, let pid = tx.portfolio?.id, exemptPortfolioIds.contains(pid) {
                return false
            }
            if !includeTaxExemptAccounts, isTaxExemptAccount(portfolio(for: tx)) {
                return false
            }
            return true
        }

        let includedIds = Set(filtered.compactMap { $0.portfolio?.id })
        let excludedCount = includeTaxExemptAccounts ? 0 : exemptPortfolioIds.count

        let ordered = filtered.sorted { $0.date < $1.date }
        var lots: [String: [TaxLot]] = [:]
        var sells: [TaxSellLine] = []
        var incomeLines: [TaxIncomeLine] = []
        var yearFees = 0.0
        var yearDiv = 0.0
        var yearInt = 0.0

        for tx in ordered {
            let ccy = CurrencyCode.normalize(tx.currency)
            let plnRate = rateOnDate(ccy, tx.date)
            func toReport(_ amount: Double) -> Double {
                convert(amount, from: ccy, to: reportCcy, rateFromToPLN: plnRate)
            }

            let inYear = cal.component(.year, from: tx.date) == year
            if inYear {
                yearFees += toReport(tx.fee)
            }

            let portfolioName = portfolio(for: tx)?.name ?? "—"
            let symbol = (tx.symbol ?? "").uppercased()
            let name = tx.name ?? symbol

            switch tx.type {
            case .buy:
                let qty = abs(tx.quantity ?? 0)
                guard qty > 0 else { continue }
                let cost = toReport(tx.gross + tx.fee)
                let key = positionKey(tx)
                lots[key, default: []].append(TaxLot(quantity: qty, cost: cost, buyDate: tx.date))

            case .sell:
                let qty = abs(tx.quantity ?? 0)
                guard qty > 0 else { continue }
                let proceeds = toReport(max(0, tx.gross - tx.fee))
                let key = positionKey(tx)
                let (cost, remainingLots) = consumeFIFO(lots: lots[key] ?? [], quantity: qty)
                lots[key] = remainingLots
                let pnl = proceeds - cost

                if inYear {
                    sells.append(TaxSellLine(
                        id: tx.id,
                        date: tx.date,
                        symbol: symbol.isEmpty ? "—" : symbol,
                        name: name,
                        portfolioName: portfolioName,
                        quantity: qty,
                        proceeds: proceeds,
                        cost: cost,
                        pnl: pnl,
                        currency: reportCcy
                    ))
                }

            case .dividend:
                let amount = toReport(abs(tx.cashDelta ?? tx.gross))
                if inYear {
                    yearDiv += amount
                    incomeLines.append(TaxIncomeLine(
                        id: tx.id,
                        date: tx.date,
                        kind: "dividend",
                        symbol: symbol.isEmpty ? "—" : symbol,
                        portfolioName: portfolioName,
                        amount: amount,
                        currency: reportCcy
                    ))
                }

            case .interest:
                let amount = toReport(abs(tx.cashDelta ?? tx.gross))
                if inYear {
                    yearInt += amount
                    incomeLines.append(TaxIncomeLine(
                        id: tx.id,
                        date: tx.date,
                        kind: "interest",
                        symbol: symbol.isEmpty ? "—" : symbol,
                        portfolioName: portfolioName,
                        amount: amount,
                        currency: reportCcy
                    ))
                }

            default:
                break
            }
        }

        let yearGains = sells.reduce(0.0) { $0 + max(0, $1.pnl) }
        let yearLosses = sells.reduce(0.0) { $0 + min(0, $1.pnl) }
        let yearProceeds = sells.reduce(0.0) { $0 + $1.proceeds }
        let yearCosts = sells.reduce(0.0) { $0 + $1.cost }

        let summary = TaxYearSummary(
            year: year,
            realizedGains: yearGains,
            realizedLosses: yearLosses,
            capitalProceeds: yearProceeds,
            capitalCosts: yearCosts,
            dividends: yearDiv,
            interest: yearInt,
            fees: yearFees,
            currency: reportCcy,
            includedPortfolioCount: includedIds.count,
            excludedTaxExemptCount: excludedCount
        )

        return TaxYearReport(
            summary: summary,
            sells: sells.sorted { $0.date > $1.date },
            incomeLines: incomeLines.sorted { $0.date > $1.date }
        )
    }

    /// Back-compat wrapper used by older tests/call sites (flat FX snapshot for every date).
    static func summary(
        year: Int,
        transactions: [Transaction],
        portfolios: [Portfolio],
        ratesToPLN: [String: Double],
        reportCurrency: String = "PLN",
        includeTaxExemptAccounts: Bool = false,
        portfolioIds: Set<UUID>? = nil
    ) -> TaxYearSummary {
        report(
            year: year,
            transactions: transactions,
            portfolios: portfolios,
            reportCurrency: reportCurrency,
            includeTaxExemptAccounts: includeTaxExemptAccounts,
            portfolioIds: portfolioIds,
            rateOnDate: { ccy, _ in
                let code = CurrencyCode.normalize(ccy)
                if code == "PLN" { return 1 }
                return ratesToPLN[code] ?? 0
            }
        ).summary
    }

    static func isTaxExemptAccount(_ portfolio: Portfolio?) -> Bool {
        guard let name = portfolio?.name.uppercased() else { return false }
        if name.contains("IKZE") { return true }
        if name.contains("XTB IKE") { return true }
        if name.hasPrefix("IKE ") || name.hasPrefix("IKE(") { return true }
        if name.range(of: #"\bIKE\b"#, options: .regularExpression) != nil { return true }
        return false
    }

    static func csv(report: TaxYearReport) -> Data {
        let s = report.summary
        var lines: [String] = [
            "# summary",
            "year,currency,proceeds,costs,net_capital,gains,losses,dividends,interest,fees,est_belka_19pct,included_portfolios,excluded_ike_ikze",
            "\(s.year),\(s.currency),\(s.capitalProceeds),\(s.capitalCosts),\(s.netCapital),\(s.realizedGains),\(s.realizedLosses),\(s.dividends),\(s.interest),\(s.fees),\(s.estimatedBelkaTax),\(s.includedPortfolioCount),\(s.excludedTaxExemptCount)",
            "",
            "# sells",
            "date,symbol,name,portfolio,quantity,proceeds,cost,pnl,currency",
        ]
        let df = DateFormatter()
        df.locale = Locale(identifier: "en_US_POSIX")
        df.dateFormat = "yyyy-MM-dd"
        for row in report.sells {
            let name = row.name.replacingOccurrences(of: ",", with: " ")
            let port = row.portfolioName.replacingOccurrences(of: ",", with: " ")
            lines.append("\(df.string(from: row.date)),\(row.symbol),\(name),\(port),\(row.quantity),\(row.proceeds),\(row.cost),\(row.pnl),\(row.currency)")
        }
        lines.append("")
        lines.append("# income")
        lines.append("date,kind,symbol,portfolio,amount,currency")
        for row in report.incomeLines {
            let port = row.portfolioName.replacingOccurrences(of: ",", with: " ")
            lines.append("\(df.string(from: row.date)),\(row.kind),\(row.symbol),\(port),\(row.amount),\(row.currency)")
        }
        return Data(lines.joined(separator: "\n").utf8)
    }

    static func csv(summary: TaxYearSummary) -> Data {
        csv(report: TaxYearReport(summary: summary, sells: [], incomeLines: []))
    }

    // MARK: - FIFO

    private struct TaxLot {
        var quantity: Double
        var cost: Double
        var buyDate: Date
    }

    private static func consumeFIFO(lots: [TaxLot], quantity: Double) -> (cost: Double, remaining: [TaxLot]) {
        var remainingQty = quantity
        var cost = 0.0
        var next: [TaxLot] = []
        for lot in lots {
            guard remainingQty > 1e-12 else {
                next.append(lot)
                continue
            }
            if lot.quantity <= remainingQty + 1e-12 {
                cost += lot.cost
                remainingQty -= lot.quantity
            } else {
                let share = remainingQty / lot.quantity
                cost += lot.cost * share
                next.append(TaxLot(
                    quantity: lot.quantity - remainingQty,
                    cost: lot.cost * (1 - share),
                    buyDate: lot.buyDate
                ))
                remainingQty = 0
            }
        }
        return (cost, next)
    }

    private static func positionKey(_ tx: Transaction) -> String {
        let sym = (tx.symbol ?? "").uppercased()
        let ccy = CurrencyCode.normalize(tx.currency)
        let pid = tx.portfolio?.id.uuidString ?? ""
        return "\(pid)|\(sym)|\(ccy)"
    }

    private static func convert(_ amount: Double, from: String, to: String, rateFromToPLN: Double) -> Double {
        let f = CurrencyCode.normalize(from)
        let t = CurrencyCode.normalize(to)
        if f == t { return amount }
        let inPLN: Double = {
            if f == "PLN" { return amount }
            guard rateFromToPLN > 0 else { return amount }
            return amount * rateFromToPLN
        }()
        if t == "PLN" { return inPLN }
        return inPLN
    }
}
