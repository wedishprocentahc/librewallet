import SwiftUI
import SwiftData

struct CashflowView: View {
    @EnvironmentObject private var appState: AppState
    @Query(sort: \Portfolio.createdAt) private var portfolios: [Portfolio]
    @Query(sort: \Transaction.date, order: .reverse) private var transactions: [Transaction]

    @State private var yearFilter: Int = Calendar.current.component(.year, from: Date())

    private var years: [Int] {
        let ys = Set(transactions.map { Calendar.current.component(.year, from: $0.date) })
        return ys.sorted(by: >)
    }

    private var events: [CashflowEvent] {
        CashflowReport.events(
            transactions: transactions,
            portfolioId: appState.selectedPortfolioId,
            year: yearFilter
        )
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Picker("Rok", selection: $yearFilter) {
                    ForEach(years.isEmpty ? [yearFilter] : years, id: \.self) { y in
                        Text(String(y)).tag(y)
                    }
                }
                .frame(maxWidth: 140)

                Picker(L10n.t("rebalance.portfolio"), selection: Binding(
                    get: { appState.selectedPortfolioId },
                    set: { appState.selectedPortfolioId = $0 }
                )) {
                    Text(L10n.t("common.all")).tag(UUID?.none)
                    ForEach(portfolios) { p in
                        Text(p.name).tag(Optional.some(p.id))
                    }
                }
                .frame(maxWidth: 280)

                Spacer()

                ForEach(CashflowReport.totalByCurrency(events).sorted(by: { $0.key < $1.key }), id: \.key) { ccy, total in
                    Text("\(ccy): \(LWFormatting.money(total, currency: ccy))")
                        .font(.callout.weight(.semibold))
                        .foregroundStyle(total >= 0 ? Color.primary : Color.red)
                }
            }
            .padding()

            if events.isEmpty {
                ContentUnavailableView(
                    L10n.t("cashflow.empty"),
                    systemImage: "arrow.left.arrow.right.circle",
                    description: Text(L10n.language == .en
                        ? "Dividends, interest, taxes, fees and bond redemptions will show up here."
                        : "Tu pojawią się dywidendy, odsetki, podatki, opłaty i wykupy obligacji.")
                )
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                List(events) { e in
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(e.symbol ?? CashflowReport.typeLabel(e.type))
                                .font(.headline)
                            Text("\(CashflowReport.typeLabel(e.type)) · \(e.portfolioName)")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        Spacer()
                        VStack(alignment: .trailing, spacing: 2) {
                            Text(signedMoney(e.amount, currency: e.currency))
                                .foregroundStyle(e.isOutflow ? Color.red : Color.green)
                            Text(e.date, style: .date)
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
            }
        }
        .navigationTitle(L10n.t("cashflow.title"))
        .id(appState.localizationEpoch)
        .onAppear {
            if let first = years.first { yearFilter = first }
        }
    }

    private func signedMoney(_ amount: Double, currency: String) -> String {
        let absText = LWFormatting.money(abs(amount), currency: currency)
        if amount < 0 { return "−\(absText)" }
        if amount > 0 { return "+\(absText)" }
        return absText
    }
}
