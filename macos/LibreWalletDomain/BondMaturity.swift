import Foundation

struct BondMaturityEntry: Identifiable, Hashable {
    var id: String { "\(portfolioId.uuidString)|\(symbol)|\(purchaseDayKey)" }
    let portfolioId: UUID
    let portfolioName: String
    let symbol: String
    let name: String
    let currency: String
    let quantity: Double
    let purchaseDate: Date
    let maturityDate: Date
    let unitValue: Double
    let terms: BondTerms

    var totalValue: Double { unitValue * quantity }
    var isPast: Bool { maturityDate < Calendar.current.startOfDay(for: Date()) }
    var year: Int { Calendar.current.component(.year, from: maturityDate) }

    private var purchaseDayKey: String {
        let df = DateFormatter()
        df.locale = Locale(identifier: "en_US_POSIX")
        df.dateFormat = "yyyy-MM-dd"
        return df.string(from: purchaseDate)
    }
}

enum BondMaturity {
    /// Open bond lots from buy/sell transactions with bond terms.
    static func openLots(
        transactions: [Transaction],
        portfolios: [Portfolio],
        asOf: Date = Date()
    ) -> [BondMaturityEntry] {
        let portfolioNames = Dictionary(uniqueKeysWithValues: portfolios.map { ($0.id, $0.name) })
        let bondTx = transactions
            .filter { tx in
                BondPricing.resolveTerms(symbol: tx.symbol, name: tx.name, notes: tx.notes, assetType: tx.assetType) != nil
            }
            .sorted { $0.date < $1.date }

        // FIFO lots per portfolio+symbol
        struct Lot {
            var qty: Double
            var purchaseDate: Date
            var terms: BondTerms
            var name: String
            var currency: String
            var portfolioId: UUID
        }

        var lots: [Lot] = []

        for tx in bondTx {
            guard let pid = tx.portfolio?.id,
                  let symbol = tx.symbol?.uppercased(), !symbol.isEmpty,
                  let terms = BondPricing.resolveTerms(symbol: tx.symbol, name: tx.name, notes: tx.notes, assetType: tx.assetType)
            else { continue }

            let qty = abs(tx.quantity ?? 0)
            guard qty > 0 else { continue }

            if tx.type == .buy {
                lots.append(Lot(
                    qty: qty,
                    purchaseDate: tx.date,
                    terms: terms,
                    name: tx.name ?? terms.code,
                    currency: tx.currency,
                    portfolioId: pid
                ))
            } else if tx.type == .sell {
                var remaining = qty
                var i = 0
                while remaining > 0.0000001, i < lots.count {
                    if lots[i].portfolioId == pid, lots[i].terms.code == terms.code || (lots[i].name == (tx.name ?? "")) {
                        let take = min(lots[i].qty, remaining)
                        lots[i].qty -= take
                        remaining -= take
                        if lots[i].qty <= 0.0000001 {
                            lots.remove(at: i)
                            continue
                        }
                    }
                    i += 1
                }
            }
        }

        return lots.compactMap { lot in
            guard lot.qty > 0.0000001 else { return nil }
            let maturity = lot.terms.maturityDateFromPurchase(lot.purchaseDate)
            let unit = BondPricing.currentPrice(terms: lot.terms, purchaseDate: lot.purchaseDate, asOf: asOf)
            return BondMaturityEntry(
                portfolioId: lot.portfolioId,
                portfolioName: portfolioNames[lot.portfolioId] ?? "—",
                symbol: lot.terms.code,
                name: lot.name,
                currency: lot.currency,
                quantity: lot.qty,
                purchaseDate: lot.purchaseDate,
                maturityDate: maturity,
                unitValue: unit,
                terms: lot.terms
            )
        }
        .sorted { $0.maturityDate < $1.maturityDate }
    }

    static func groupedByYear(_ entries: [BondMaturityEntry]) -> [(year: Int, items: [BondMaturityEntry])] {
        let upcoming = entries.filter { !$0.isPast }
        let years = Dictionary(grouping: upcoming, by: \.year)
        return years.keys.sorted().map { year in
            (year, years[year]!.sorted { $0.maturityDate < $1.maturityDate })
        }
    }
}
