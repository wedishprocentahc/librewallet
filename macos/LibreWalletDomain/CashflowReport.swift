import Foundation

struct CashflowEvent: Identifiable, Hashable {
    let id: UUID
    let date: Date
    let type: String
    let symbol: String?
    let name: String?
    /// Signed cashflow: +inflow, −outflow.
    let amount: Double
    let currency: String
    let portfolioName: String

    var isOutflow: Bool { amount < 0 }
}

enum CashflowReport {
    static func events(
        transactions: [Transaction],
        portfolioId: UUID? = nil,
        year: Int? = nil
    ) -> [CashflowEvent] {
        let cal = Calendar.current
        return transactions
            .compactMap { tx -> CashflowEvent? in
                if let portfolioId, tx.portfolio?.id != portfolioId { return nil }
                if let year, cal.component(.year, from: tx.date) != year { return nil }
                guard let signed = signedAmount(for: tx) else { return nil }
                guard abs(signed) > 0.0000001 else { return nil }
                return CashflowEvent(
                    id: tx.id,
                    date: tx.date,
                    type: tx.typeRaw,
                    symbol: tx.symbol,
                    name: tx.name,
                    amount: signed,
                    currency: tx.currency,
                    portfolioName: tx.portfolio?.name ?? "—"
                )
            }
            .sorted { $0.date > $1.date }
    }

    /// Net total per currency (inflows − outflows).
    static func totalByCurrency(_ events: [CashflowEvent]) -> [String: Double] {
        var map: [String: Double] = [:]
        for e in events {
            map[e.currency, default: 0] += e.amount
        }
        return map
    }

    static func typeLabel(_ type: String) -> String {
        switch type {
        case "dividend": return L10n.language == .en ? "Dividend" : "Dywidenda"
        case "interest": return L10n.language == .en ? "Interest" : "Odsetki"
        case "tax": return L10n.language == .en ? "Tax" : "Podatek"
        case "fee": return L10n.language == .en ? "Fee" : "Opłata"
        case "sell": return L10n.language == .en ? "Sale / redemption" : "Sprzedaż / wykup"
        case "withdrawal": return L10n.language == .en ? "Withdrawal" : "Wypłata"
        case "deposit": return L10n.language == .en ? "Deposit" : "Wpłata"
        default: return type
        }
    }

    /// Returns signed cash amount, or nil if the transaction is not a cashflow event.
    private static func signedAmount(for tx: Transaction) -> Double? {
        let raw = abs(tx.cashDelta ?? tx.gross)

        switch tx.type {
        case .dividend, .interest:
            return raw
        case .tax, .fee:
            return -raw
        case .withdrawal:
            return -raw
        case .deposit:
            return raw
        case .sell:
            // Bond redemption / sale proceeds as inflow.
            if (tx.assetType ?? "").lowercased() == "bond"
                || (tx.source ?? "").localizedCaseInsensitiveContains("redeem") {
                return abs(tx.gross - tx.fee)
            }
            return nil
        default:
            return nil
        }
    }
}
