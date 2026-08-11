import SwiftUI
import SwiftData

struct TransactionsView: View {
    @Environment(\.modelContext) private var context
    @EnvironmentObject private var appState: AppState

    @Query(sort: \Portfolio.createdAt) private var portfolios: [Portfolio]
    @Query(sort: \Transaction.date, order: .reverse) private var transactions: [Transaction]

    @State private var showAdd = false
    @State private var searchText = ""

    var body: some View {
        VStack(alignment: .leading) {
            HStack {
                Picker("Portfel", selection: Binding(get: { appState.selectedPortfolioId }, set: { appState.selectedPortfolioId = $0 })) {
                    Text(L10n.t("common.all")).tag(UUID?.none)
                    ForEach(portfolios) { portfolio in
                        Text(portfolio.name).tag(UUID?.some(portfolio.id))
                    }
                }
                .frame(maxWidth: 320)

                TextField(L10n.t("tx.searchPlaceholder"), text: $searchText)
                    .textFieldStyle(.roundedBorder)
                    .frame(maxWidth: 280)

                Spacer()

                Button {
                    showAdd = true
                } label: {
                    Label(L10n.t("common.add"), systemImage: "plus")
                }
                .buttonStyle(.borderedProminent)
            }
            .padding([.horizontal, .top])

            List {
                ForEach(filteredTransactions) { tx in
                    TransactionRow(transaction: tx)
                }
                .onDelete(perform: deleteTransactions)
            }
        }
        .navigationTitle(L10n.t("tx.title"))
        .id(appState.localizationEpoch)
        .sheet(isPresented: $showAdd) {
            AddTransactionSheet(portfolios: portfolios)
        }
    }

    private var filteredTransactions: [Transaction] {
        var list = transactions
        if let pid = appState.selectedPortfolioId {
            list = list.filter { $0.portfolio?.id == pid }
        }
        let q = searchText.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !q.isEmpty else { return list }
        return list.filter { tx in
            let hay = [
                tx.symbol ?? "",
                tx.name ?? "",
                tx.typeRaw,
                tx.notes ?? "",
                tx.source ?? "",
                tx.currency,
            ].joined(separator: " ").lowercased()
            return hay.contains(q)
        }
    }

    private func deleteTransactions(at offsets: IndexSet) {
        let items = offsets.map { filteredTransactions[$0] }
        for tx in items { context.delete(tx) }
        try? context.save()
        appState.notifySuccess(L10n.t("feedback.txDeleted", ["count": "\(items.count)"]))
    }
}

struct ImportView: View {
    var body: some View {
        ImportScreen()
    }
}

