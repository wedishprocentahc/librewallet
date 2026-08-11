import SwiftUI
import SwiftData

struct PositionsView: View {
    @Environment(\.modelContext) private var context
    @EnvironmentObject private var appState: AppState

    @Query(sort: \Portfolio.createdAt) private var portfolios: [Portfolio]
    @Query(sort: \Transaction.date) private var transactions: [Transaction]
    @Query(sort: \Quote.asOf, order: .reverse) private var quotes: [Quote]

    @State private var confirmDeletePosition: (symbol: String, currency: String, name: String, portfolioId: UUID?)?
    @State private var ratesToPLN: [String: Double] = NBPExchangeRateService.cachedRatesToPLN()
    @State private var searchText = ""
    @State private var groupBy: PositionGroupBy = .none
    @State private var holdFilter: PositionHoldFilter = .open
    @State private var priceHistory: [String: [(date: Date, close: Double)]] = [:]
    @State private var mappingTarget: (symbol: String, currency: String)?

    private var scopedPortfolios: [Portfolio] {
        if let pid = appState.selectedPortfolioId {
            return portfolios.filter { $0.id == pid }
        }
        if let gid = appState.selectedGroupId {
            return portfolios.filter { $0.group?.id == gid }
        }
        return portfolios
    }

    private var scope: ScopeResult {
        let scoped = scopedPortfolios
        if scoped.count == 1, let portfolio = scoped.first {
            return PortfolioCalculator.calculate(
                portfolio: portfolio,
                allTransactions: transactions,
                quotes: quotes,
                ratesToPLN: ratesToPLN
            )
        }
        return PortfolioCalculator.aggregateToPLN(
            portfolios: scoped,
            allTransactions: transactions,
            quotes: quotes,
            ratesToPLN: ratesToPLN
        )
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                TextField(L10n.t("common.search"), text: $searchText)
                    .textFieldStyle(.roundedBorder)
                    .frame(maxWidth: 240)
                Picker(L10n.t("positions.groupBy"), selection: $groupBy) {
                    Text(L10n.t("positions.group.none")).tag(PositionGroupBy.none)
                    Text(L10n.t("positions.group.type")).tag(PositionGroupBy.type)
                    Text(L10n.t("positions.group.currency")).tag(PositionGroupBy.currency)
                    Text(L10n.t("positions.group.portfolio")).tag(PositionGroupBy.portfolio)
                    Text(L10n.t("positions.group.group")).tag(PositionGroupBy.group)
                }
                .frame(maxWidth: 280)
                Picker("", selection: $holdFilter) {
                    Text(L10n.t("positions.hold.open")).tag(PositionHoldFilter.open)
                    Text(L10n.t("positions.hold.all")).tag(PositionHoldFilter.allTime)
                }
                .pickerStyle(.segmented)
                .frame(maxWidth: 260)
                Spacer()
            }
            .padding([.horizontal, .top])

            PositionsListContent(
                scope: scope,
                emptyDescription: "Brak pozycji w bieżącym zakresie. Wybierz portfel albo zaimportuj operacje.",
                searchText: searchText,
                groupBy: groupBy,
                holdFilter: holdFilter,
                priceHistory: priceHistory,
                onDeleteRequest: { pos in
                    confirmDeletePosition = (pos.symbol, pos.currency, pos.name, pos.portfolioId)
                },
                onMapTicker: { pos in
                    mappingTarget = (pos.symbol, pos.currency)
                }
            )
        }
        .navigationTitle(L10n.t("positions.title"))
        .id(appState.localizationEpoch)
        .sheet(item: Binding(
            get: { mappingTarget.map { PositionMappingItem(symbol: $0.symbol, currency: $0.currency) } },
            set: { mappingTarget = $0.map { ($0.symbol, $0.currency) } }
        )) { item in
            SymbolMappingSheet(xtbSymbol: item.symbol, positionCurrency: item.currency)
        }
        .task {
            await loadRates()
            priceHistory = PricingService.loadCachedHistories()
            if priceHistory.isEmpty {
                let symbols = Set(transactions.compactMap { $0.symbol?.uppercased() }.filter { !$0.isEmpty })
                if !symbols.isEmpty {
                    priceHistory = await PricingService.refreshHistories(symbols: Array(symbols))
                }
            }
        }
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
                deletePosition(symbol: pos.symbol, currency: pos.currency, portfolioId: pos.portfolioId)
                confirmDeletePosition = nil
            }
        } message: { pos in
            Text("To skasuje wszystkie operacje dla \(pos.symbol) (\(pos.currency)) w bieżącym zakresie.")
        }
    }

    private func loadRates() async {
        if let rates = try? await NBPExchangeRateService.ratesToPLN() {
            ratesToPLN = rates
        }
    }

    private func deletePosition(symbol: String, currency: String, portfolioId: UUID? = nil) {
        let scopedIds = Set(scopedPortfolios.map(\.id))
        let normSymbol = symbol.uppercased()
        let normCurrency = currency.uppercased()
        let toDelete = transactions.filter { tx in
            guard let pid = tx.portfolio?.id, scopedIds.contains(pid) else { return false }
            if let portfolioId, pid != portfolioId { return false }
            return (tx.symbol ?? "").uppercased() == normSymbol
                && tx.currency.uppercased() == normCurrency
        }
        for tx in toDelete { context.delete(tx) }
        try? context.save()
    }
}

struct GroupDetailView: View {
    let groupId: UUID

    @Environment(\.modelContext) private var context
    @EnvironmentObject private var appState: AppState

    @Query(sort: \Portfolio.createdAt) private var portfolios: [Portfolio]
    @Query(sort: \PortfolioGroup.createdAt) private var groups: [PortfolioGroup]
    @Query(sort: \Transaction.date) private var transactions: [Transaction]
    @Query(sort: \Quote.asOf, order: .reverse) private var quotes: [Quote]

    @State private var confirmDeletePosition: (symbol: String, currency: String, name: String, portfolioId: UUID?)?
    @State private var ratesToPLN: [String: Double] = NBPExchangeRateService.cachedRatesToPLN()

    private var group: PortfolioGroup? {
        groups.first(where: { $0.id == groupId })
    }

    private var scopedPortfolios: [Portfolio] {
        portfolios.filter { $0.group?.id == groupId }
    }

    private var scope: ScopeResult {
        PortfolioCalculator.aggregateToPLN(
            portfolios: scopedPortfolios,
            allTransactions: transactions,
            quotes: quotes,
            ratesToPLN: ratesToPLN
        )
    }

    var body: some View {
        PositionsListContent(
            scope: scope,
            emptyDescription: "Brak pozycji w tej grupie.",
            onDeleteRequest: { pos in
                confirmDeletePosition = (pos.symbol, pos.currency, pos.name, pos.portfolioId)
            }
        )
        .navigationTitle(group?.name ?? "Grupa")
        .task { await loadRates() }
        .onAppear {
            appState.selectedGroupId = groupId
            appState.selectedPortfolioId = nil
        }
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
                deletePosition(symbol: pos.symbol, currency: pos.currency, portfolioId: pos.portfolioId)
                confirmDeletePosition = nil
            }
        } message: { pos in
            Text("To skasuje wszystkie operacje dla \(pos.symbol) (\(pos.currency)) w tej grupie.")
        }
    }

    private func loadRates() async {
        if let rates = try? await NBPExchangeRateService.ratesToPLN() {
            ratesToPLN = rates
        }
    }

    private func deletePosition(symbol: String, currency: String, portfolioId: UUID? = nil) {
        let scopedIds = Set(scopedPortfolios.map(\.id))
        let normSymbol = symbol.uppercased()
        let normCurrency = currency.uppercased()
        let toDelete = transactions.filter { tx in
            guard let pid = tx.portfolio?.id, scopedIds.contains(pid) else { return false }
            if let portfolioId, pid != portfolioId { return false }
            return (tx.symbol ?? "").uppercased() == normSymbol
                && tx.currency.uppercased() == normCurrency
        }
        for tx in toDelete { context.delete(tx) }
        try? context.save()
    }
}

struct PortfolioDetailView: View {
    let portfolioId: UUID

    @Environment(\.modelContext) private var context
    @EnvironmentObject private var appState: AppState

    @Query(sort: \Portfolio.createdAt) private var portfolios: [Portfolio]
    @Query(sort: \Transaction.date) private var transactions: [Transaction]
    @Query(sort: \Quote.asOf, order: .reverse) private var quotes: [Quote]

    @State private var confirmDeletePosition: (symbol: String, currency: String, name: String, portfolioId: UUID?)?
    @State private var ratesToPLN: [String: Double] = NBPExchangeRateService.cachedRatesToPLN()

    private var portfolio: Portfolio? {
        portfolios.first(where: { $0.id == portfolioId })
    }

    private var scope: ScopeResult {
        guard let portfolio else {
            return PortfolioCalculator.calculate(portfolio: nil, allTransactions: [], quotes: [])
        }
        return PortfolioCalculator.calculate(
            portfolio: portfolio,
            allTransactions: transactions,
            quotes: quotes,
            ratesToPLN: ratesToPLN
        )
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if let portfolio {
                portfolioSummary(portfolio: portfolio, scope: scope)
                    .padding()
                Divider()
            }

            PositionsListContent(
                scope: scope,
                emptyDescription: "Brak pozycji w tym portfelu. Zaimportuj operacje albo dodaj obligacje.",
                onDeleteRequest: { pos in
                    confirmDeletePosition = (pos.symbol, pos.currency, pos.name, pos.portfolioId)
                }
            )
        }
        .navigationTitle(portfolio?.name ?? "Portfel")
        .task { await loadRates() }
        .onAppear {
            if let portfolio {
                appState.selectPortfolio(portfolio)
            }
        }
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
            Text("To skasuje wszystkie operacje dla \(pos.symbol) (\(pos.currency)) w tym portfelu.")
        }
    }

    private func loadRates() async {
        if let rates = try? await NBPExchangeRateService.ratesToPLN() {
            ratesToPLN = rates
        }
    }

    @ViewBuilder
    private func portfolioSummary(portfolio: Portfolio, scope: ScopeResult) -> some View {
        HStack(spacing: 24) {
            summaryMetric(title: "Wartość", value: LWFormatting.money(scope.totalValueBase, currency: CurrencyCode.normalize(portfolio.baseCurrency)))
            summaryMetric(
                title: "Zysk",
                value: LWFormatting.money(scope.totalProfitBase, currency: CurrencyCode.normalize(portfolio.baseCurrency)),
                tint: scope.totalProfitBase >= 0 ? .green : .red
            )
            summaryMetric(title: "Zwrot", value: String(format: "%.2f%%", scope.returnPct))
            if scope.hasCashOperations, abs(scope.cashValueBase) > 0.01 {
                summaryMetric(title: "Gotówka", value: LWFormatting.money(scope.cashValueBase, currency: CurrencyCode.normalize(portfolio.baseCurrency)))
            }
            Spacer()
        }
    }

    private func summaryMetric(title: String, value: String, tint: Color = .primary) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title)
                .font(.caption)
                .foregroundStyle(.secondary)
            Text(value)
                .font(.title3.weight(.semibold))
                .foregroundStyle(tint)
        }
    }

    private func deletePosition(symbol: String, currency: String) {
        let normSymbol = symbol.uppercased()
        let normCurrency = currency.uppercased()
        let toDelete = transactions.filter { tx in
            guard tx.portfolio?.id == portfolioId else { return false }
            return (tx.symbol ?? "").uppercased() == normSymbol
                && tx.currency.uppercased() == normCurrency
        }
        for tx in toDelete { context.delete(tx) }
        try? context.save()
    }
}

private enum PositionGroupBy: String, CaseIterable, Hashable {
    case none
    case type
    case currency
    case portfolio
    case group
}

private enum PositionHoldFilter: String, CaseIterable, Hashable {
    case open
    case allTime
}

private struct PositionsListContent: View {
    let scope: ScopeResult
    let emptyDescription: String
    var searchText: String = ""
    var groupBy: PositionGroupBy = .none
    var holdFilter: PositionHoldFilter = .open
    var priceHistory: [String: [(date: Date, close: Double)]] = [:]
    let onDeleteRequest: (PositionRow) -> Void
    var onMapTicker: ((PositionRow) -> Void)? = nil

    private var filtered: [PositionRow] {
        var rows = scope.positions
        switch holdFilter {
        case .open:
            rows = rows.filter { abs($0.quantity) > 0.0000001 }
        case .allTime:
            break
        }
        let q = searchText.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !q.isEmpty else { return rows }
        return rows.filter {
            $0.symbol.lowercased().contains(q)
                || $0.name.lowercased().contains(q)
                || $0.currency.lowercased().contains(q)
                || $0.assetType.lowercased().contains(q)
                || $0.portfolioName.lowercased().contains(q)
                || $0.groupName.lowercased().contains(q)
        }
    }

    private var sections: [(title: String, items: [PositionRow])] {
        switch groupBy {
        case .none:
            return [("", filtered)]
        case .type:
            let g = Dictionary(grouping: filtered, by: \.assetType)
            return g.keys.sorted().map { (L10n.assetLabel($0), g[$0]!) }
        case .currency:
            let g = Dictionary(grouping: filtered, by: \.currency)
            return g.keys.sorted().map { ($0, g[$0]!) }
        case .portfolio:
            let g = Dictionary(grouping: filtered) { pos in
                pos.portfolioName.isEmpty ? "—" : pos.portfolioName
            }
            return g.keys.sorted { $0.localizedCaseInsensitiveCompare($1) == .orderedAscending }
                .map { ($0, g[$0]!.sorted { $0.symbol < $1.symbol }) }
        case .group:
            let ungrouped = L10n.t("positions.group.ungrouped")
            let g = Dictionary(grouping: filtered) { pos in
                pos.groupName.isEmpty ? ungrouped : pos.groupName
            }
            return g.keys.sorted { a, b in
                if a == ungrouped { return false }
                if b == ungrouped { return true }
                return a.localizedCaseInsensitiveCompare(b) == .orderedAscending
            }
            .map { ($0, g[$0]!.sorted { $0.symbol < $1.symbol }) }
        }
    }

    var body: some View {
        if filtered.isEmpty {
            ContentUnavailableView(
                "Brak pozycji",
                systemImage: "briefcase",
                description: Text(emptyDescription)
            )
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            List {
                ForEach(sections, id: \.title) { section in
                    if section.title.isEmpty {
                        ForEach(section.items, id: \.id) { pos in
                            positionRow(pos)
                        }
                    } else {
                        Section(section.title) {
                            ForEach(section.items, id: \.id) { pos in
                                positionRow(pos)
                            }
                        }
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func positionRow(_ pos: PositionRow) -> some View {
        let returns = PeriodReturns.allReturns(
            symbol: pos.symbol,
            currentPrice: pos.currentPrice,
            histories: priceHistory
        )
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(pos.symbol).font(.headline)
                    if abs(pos.quantity) <= 0.0000001 {
                        Text(L10n.t("positions.closed"))
                            .font(.caption2.weight(.semibold))
                            .padding(.horizontal, 5)
                            .padding(.vertical, 1)
                            .background(.quaternary, in: Capsule())
                            .foregroundStyle(.secondary)
                    }
                }
                Text(pos.name).font(.caption).foregroundStyle(.secondary)
                if groupBy != .portfolio, !pos.portfolioName.isEmpty {
                    Text(pos.portfolioName)
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                }
                Text("\(LWFormatting.number(pos.quantity)) szt. · średnio \(LWFormatting.money(pos.avgCost, currency: pos.currency))")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                if let meta = AppPreferences.quoteResolutionMeta[pos.symbol.uppercased()] {
                    Text("Yahoo: \(meta.providerSymbol)")
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                } else if case .failure = SymbolResolver.resolve(xtbSymbol: pos.symbol, positionCurrency: pos.currency) {
                    Text(L10n.t("mapping.unresolved"))
                        .font(.caption2)
                        .foregroundStyle(.orange)
                }
                if !returns.isEmpty {
                    HStack(spacing: 8) {
                        ForEach(ReturnPeriod.allCases) { period in
                            if let pct = returns[period] {
                                Text("\(period.rawValue) \(String(format: "%+.1f%%", pct))")
                                    .font(.caption2.monospacedDigit())
                                    .foregroundStyle(pct >= 0 ? .green : .red)
                            }
                        }
                    }
                }
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
            if let onMapTicker {
                Button(L10n.t("mapping.edit")) {
                    onMapTicker(pos)
                }
            }
            Button("Usuń pozycję…", role: .destructive) {
                onDeleteRequest(pos)
            }
        }
    }
}

private struct PositionMappingItem: Identifiable {
    var id: String { "\(symbol)|\(currency)" }
    let symbol: String
    let currency: String
}


