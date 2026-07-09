import SwiftUI
import SwiftData
import Charts
import UniformTypeIdentifiers

struct DashboardView: View {
    @Environment(\.modelContext) private var context
    @EnvironmentObject private var appState: AppState
    @Query(sort: \Portfolio.createdAt) private var portfolios: [Portfolio]
    @Query(sort: \PortfolioGroup.createdAt) private var groups: [PortfolioGroup]
    @Query(sort: \Transaction.date) private var transactions: [Transaction]
    @Query(sort: \Quote.asOf, order: .reverse) private var quotes: [Quote]
    @State private var isRefreshingPrices = false
    @State private var refreshError: String?
    @State private var ratesToPLN: [String: Double] = ["PLN": 1.0]
    @State private var confirmDeletePosition: (symbol: String, currency: String, name: String)?

    var body: some View {
        let scope = dashboardScope

        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                header()
                if let refreshError {
                    Text(refreshError).foregroundStyle(.red)
                }

                kpiRow(scope: scope)

                GroupBox("Alokacja (wg typu)") {
                    if scope.allocationByType.isEmpty {
                        ContentUnavailableView("Brak danych", systemImage: "chart.pie", description: Text("Dodaj operacje lub zaimportuj historię."))
                            .frame(maxWidth: .infinity, minHeight: 160)
                    } else {
                        Chart(allocationRows(scope)) { row in
                            BarMark(
                                x: .value("Wartość", row.value),
                                y: .value("Typ", row.label)
                            )
                        }
                        .chartXAxisLabel("Wartość")
                        .frame(height: 220)
                        .padding(.top, 8)
                    }
                }
            }
            .padding()
        }
        .navigationTitle("Dashboard")
        .alert(
            "Usunąć pozycję?",
            isPresented: Binding(
                get: { confirmDeletePosition != nil },
                set: { if !$0 { confirmDeletePosition = nil } }
            ),
            presenting: confirmDeletePosition
        ) { pos in
            Button("Anuluj", role: .cancel) {
                confirmDeletePosition = nil
            }
            Button("Usuń", role: .destructive) {
                deletePosition(symbol: pos.symbol, currency: pos.currency)
                confirmDeletePosition = nil
            }
        } message: { pos in
            Text("To skasuje wszystkie operacje dla \(pos.symbol) (\(pos.currency)) w bieżącym zakresie: \(scopeTitle).")
        }
        .task {
            await loadNBPRates()
        }
    }

    private var scopedPortfolios: [Portfolio] {
        if let pid = appState.selectedPortfolioId {
            return portfolios.filter { $0.id == pid }
        }
        if let gid = appState.selectedGroupId {
            return portfolios.filter { $0.group?.id == gid }
        }
        return portfolios
    }

    private var dashboardScope: ScopeResult {
        let scoped = scopedPortfolios
        if scoped.count == 1, let portfolio = scoped.first {
            return PortfolioCalculator.calculate(
                portfolio: portfolio,
                allTransactions: transactions,
                quotes: quotes
            )
        }
        return PortfolioCalculator.aggregateToPLN(
            portfolios: scoped,
            allTransactions: transactions,
            quotes: quotes,
            ratesToPLN: ratesToPLN
        )
    }

    private var scopeTitle: String {
        if let pid = appState.selectedPortfolioId, let p = portfolios.first(where: { $0.id == pid }) {
            return p.name
        }
        if let gid = appState.selectedGroupId, let g = groups.first(where: { $0.id == gid }) {
            return g.name
        }
        return "Wszystkie"
    }

    @ViewBuilder
    private func header() -> some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text("Zakres").font(.caption).foregroundStyle(.secondary)
                Text(scopeTitle).font(.title2.weight(.bold))
            }
            Spacer()

            Picker("Zakres", selection: scopeBinding) {
                Text("Wszystkie").tag(DashboardScope.all)
                if !groups.isEmpty {
                    Divider()
                    ForEach(groups) { g in
                        Text("Grupa: \(g.name)").tag(DashboardScope.group(g.id))
                    }
                }
                if !portfolios.isEmpty {
                    Divider()
                    ForEach(portfolios) { p in
                        Text("Portfel: \(p.name)").tag(DashboardScope.portfolio(p.id))
                    }
                }
            }
            .labelsHidden()
            .pickerStyle(.menu)

            Button {
                Task { await refreshPrices() }
            } label: {
                if isRefreshingPrices {
                    ProgressView().controlSize(.small)
                } else {
                    Label("Ceny", systemImage: "arrow.clockwise")
                }
            }
            .disabled(isRefreshingPrices)
        }
    }

    private var scopeBinding: Binding<DashboardScope> {
        Binding(
            get: {
                if let pid = appState.selectedPortfolioId { return .portfolio(pid) }
                if let gid = appState.selectedGroupId { return .group(gid) }
                return .all
            },
            set: { newValue in
                switch newValue {
                case .all:
                    appState.selectedPortfolioId = nil
                    appState.selectedGroupId = nil
                case .group(let gid):
                    appState.selectedPortfolioId = nil
                    appState.selectedGroupId = gid
                case .portfolio(let pid):
                    appState.selectedPortfolioId = pid
                    if let p = portfolios.first(where: { $0.id == pid }) {
                        appState.selectedGroupId = p.group?.id
                    }
                }
            }
        )
    }

    private func loadNBPRates() async {
        do {
            ratesToPLN = try await NBPExchangeRateService.ratesToPLN()
        } catch {
            refreshError = error.localizedDescription
        }
    }

    private func refreshPrices() async {
        isRefreshingPrices = true
        refreshError = nil
        do {
            try await PricingService.refreshQuotes(for: transactions, context: context)
            await loadNBPRates()
        } catch {
            refreshError = error.localizedDescription
        }
        isRefreshingPrices = false
    }

    private func deletePosition(symbol: String, currency: String) {
        let scopedIds = Set(scopedPortfolios.map { $0.id })
        let normSymbol = symbol.uppercased()
        let normCurrency = currency.uppercased()

        let toDelete = transactions.filter { tx in
            guard let pid = tx.portfolio?.id, scopedIds.contains(pid) else { return false }
            return (tx.symbol ?? "").uppercased() == normSymbol
                && tx.currency.uppercased() == normCurrency
        }

        for tx in toDelete { context.delete(tx) }
        try? context.save()
    }

    private func kpiRow(scope: ScopeResult) -> some View {
        HStack(spacing: 12) {
            KPI(title: "Wartość", value: LWFormatting.money(scope.totalValueBase, currency: scope.baseCurrency))
            KPI(title: "Zysk", value: LWFormatting.money(scope.totalProfitBase, currency: scope.baseCurrency), accent: scope.totalProfitBase >= 0 ? .green : .red)
            KPI(title: "Zwrot", value: LWFormatting.percent(scope.returnPct), accent: scope.returnPct >= 0 ? .green : .red)
            KPI(title: "Wkład", value: LWFormatting.money(scope.netInvestedBase, currency: scope.baseCurrency))
        }
    }

    private func allocationRows(_ scope: ScopeResult) -> [AllocationRow] {
        scope.allocationByType
            .map { AllocationRow(key: $0.key, value: $0.value) }
            .sorted { $0.value > $1.value }
    }
}

private struct KPI: View {
    let title: String
    let value: String
    var accent: Color? = nil

    var body: some View {
        GroupBox {
            VStack(alignment: .leading, spacing: 6) {
                Text(title).font(.caption).foregroundStyle(.secondary)
                Text(value).font(.title3.weight(.bold)).foregroundStyle(accent ?? .primary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

private struct AllocationRow: Identifiable {
    var id: String { key }
    let key: String
    let value: Double

    var label: String {
        switch key {
        case "etf": "ETF"
        case "stock": "Akcje"
        case "bond": "Obligacje"
        case "cash": "Gotówka"
        default: key
        }
    }
}

private enum DashboardScope: Hashable {
    case all
    case group(UUID)
    case portfolio(UUID)
}

struct TransactionsView: View {
    @Environment(\.modelContext) private var context
    @EnvironmentObject private var appState: AppState

    @Query(sort: \Portfolio.createdAt) private var portfolios: [Portfolio]
    @Query(sort: \Transaction.date, order: .reverse) private var transactions: [Transaction]

    @State private var showAdd = false

    var body: some View {
        VStack(alignment: .leading) {
            HStack {
                Picker("Portfel", selection: Binding(get: { appState.selectedPortfolioId }, set: { appState.selectedPortfolioId = $0 })) {
                    Text("Wszystkie").tag(UUID?.none)
                    ForEach(portfolios) { portfolio in
                        Text(portfolio.name).tag(UUID?.some(portfolio.id))
                    }
                }
                .frame(maxWidth: 320)

                Spacer()

                Button {
                    showAdd = true
                } label: {
                    Label("Dodaj", systemImage: "plus")
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
        .navigationTitle("Operacje")
        .sheet(isPresented: $showAdd) {
            AddTransactionSheet(portfolios: portfolios)
        }
    }

    private var filteredTransactions: [Transaction] {
        guard let pid = appState.selectedPortfolioId else { return transactions }
        return transactions.filter { $0.portfolio?.id == pid }
    }

    private func deleteTransactions(at offsets: IndexSet) {
        let items = offsets.map { filteredTransactions[$0] }
        for tx in items { context.delete(tx) }
        try? context.save()
    }
}

struct PositionsView: View {
    @Environment(\.modelContext) private var context
    @EnvironmentObject private var appState: AppState

    @Query(sort: \Portfolio.createdAt) private var portfolios: [Portfolio]
    @Query(sort: \PortfolioGroup.createdAt) private var groups: [PortfolioGroup]
    @Query(sort: \Transaction.date) private var transactions: [Transaction]
    @Query(sort: \Quote.asOf, order: .reverse) private var quotes: [Quote]

    @State private var confirmDeletePosition: (symbol: String, currency: String, name: String)?

    var body: some View {
        let scope = scopeForCurrentSelection()
        List {
            ForEach(scope.positions, id: \.id) { pos in
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(pos.symbol).font(.headline)
                        Text(pos.name).font(.caption).foregroundStyle(.secondary)
                    }
                    Spacer()
                    VStack(alignment: .trailing, spacing: 2) {
                        Text(LWFormatting.money(pos.currentValue, currency: pos.currency)).font(.headline)
                        Text(LWFormatting.money(pos.totalProfit, currency: pos.currency))
                            .font(.caption)
                            .foregroundStyle(pos.totalProfit >= 0 ? .green : .red)
                    }
                }
                .contentShape(Rectangle())
                .contextMenu {
                    Button("Usuń pozycję…", role: .destructive) {
                        confirmDeletePosition = (pos.symbol, pos.currency, pos.name)
                    }
                }
            }
        }
        .navigationTitle("Pozycje")
        .alert(
            "Usunąć pozycję?",
            isPresented: Binding(
                get: { confirmDeletePosition != nil },
                set: { if !$0 { confirmDeletePosition = nil } }
            ),
            presenting: confirmDeletePosition
        ) { pos in
            Button("Anuluj", role: .cancel) {
                confirmDeletePosition = nil
            }
            Button("Usuń", role: .destructive) {
                deletePosition(symbol: pos.symbol, currency: pos.currency)
                confirmDeletePosition = nil
            }
        } message: { pos in
            Text("To skasuje wszystkie operacje dla \(pos.symbol) (\(pos.currency)) w bieżącym zakresie.")
        }
    }

    private func scopedPortfolios() -> [Portfolio] {
        if let pid = appState.selectedPortfolioId {
            return portfolios.filter { $0.id == pid }
        }
        if let gid = appState.selectedGroupId {
            return portfolios.filter { $0.group?.id == gid }
        }
        return portfolios
    }

    private func scopeForCurrentSelection() -> ScopeResult {
        let scoped = scopedPortfolios()
        if scoped.count == 1, let portfolio = scoped.first {
            return PortfolioCalculator.calculate(
                portfolio: portfolio,
                allTransactions: transactions,
                quotes: quotes
            )
        }
        return PortfolioCalculator.aggregateToPLN(
            portfolios: scoped,
            allTransactions: transactions,
            quotes: quotes,
            ratesToPLN: ["PLN": 1.0]
        )
    }

    private func deletePosition(symbol: String, currency: String) {
        let scopedIds = Set(scopedPortfolios().map { $0.id })
        let normSymbol = symbol.uppercased()
        let normCurrency = currency.uppercased()

        let toDelete = transactions.filter { tx in
            guard let pid = tx.portfolio?.id, scopedIds.contains(pid) else { return false }
            return (tx.symbol ?? "").uppercased() == normSymbol
                && tx.currency.uppercased() == normCurrency
        }

        for tx in toDelete { context.delete(tx) }
        try? context.save()
    }
}

struct ImportView: View {
    var body: some View {
        ImportScreen()
    }
}

struct SettingsView: View {
    @Environment(\.modelContext) private var context
    @State private var exportDoc: LWBackupDocument?
    @State private var importing = false
    @State private var showExport = false
    @State private var errorMessage: String?

    var body: some View {
        Form {
            Section("Backup") {
                Button("Eksportuj backup…") {
                    do {
                        exportDoc = LWBackupDocument(data: try BackupService.export(context: context))
                        showExport = true
                    } catch {
                        errorMessage = error.localizedDescription
                    }
                }

                Button("Importuj backup…") {
                    importing = true
                }
            }

            if let errorMessage {
                Section("Błąd") {
                    Text(errorMessage).foregroundStyle(.red)
                }
            }
        }
        .padding()
        .navigationTitle("Ustawienia")
        .fileExporter(
            isPresented: $showExport,
            document: exportDoc,
            contentType: .json,
            defaultFilename: "librewallet-backup.json"
        ) { result in
            if case .failure(let err) = result {
                errorMessage = err.localizedDescription
            }
        }
        .fileImporter(
            isPresented: $importing,
            allowedContentTypes: [.json],
            allowsMultipleSelection: false
        ) { result in
            do {
                guard let url = try result.get().first else { return }
                let data = try Data(contentsOf: url)
                try BackupService.import(data: data, context: context, wipeExisting: true)
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }
}

struct GroupDetailView: View {
    let groupId: PersistentIdentifier

    var body: some View {
        Text("Grupa \(groupId)")
            .navigationTitle("Grupa")
    }
}

struct PortfolioDetailView: View {
    let portfolioId: PersistentIdentifier

    var body: some View {
        ContentUnavailableView("Portfel", systemImage: "briefcase", description: Text("Wybierz portfel z paska bocznego, aby zobaczyć szczegóły."))
            .navigationTitle("Portfel")
    }
}

