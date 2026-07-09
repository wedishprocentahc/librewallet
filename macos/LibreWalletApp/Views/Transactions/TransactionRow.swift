import SwiftUI

struct TransactionRow: View {
    let transaction: Transaction

    var body: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.headline)
                Text(subtitle)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 2) {
                Text(LWFormatting.money(transaction.gross, currency: transaction.currency))
                    .font(.headline)
                Text(shortDate(transaction.date))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 4)
    }

    private var title: String {
        let type = transaction.typeRaw.uppercased()
        let symbol = transaction.symbol ?? ""
        let name = transaction.name ?? ""
        if !symbol.isEmpty { return "\(type) \(symbol)" }
        if !name.isEmpty { return "\(type) \(name)" }
        return type
    }

    private var subtitle: String {
        let portfolio = transaction.portfolio?.name ?? "—"
        return portfolio
    }

    private func shortDate(_ date: Date) -> String {
        let f = DateFormatter()
        f.dateStyle = .medium
        f.timeStyle = .none
        return f.string(from: date)
    }
}

