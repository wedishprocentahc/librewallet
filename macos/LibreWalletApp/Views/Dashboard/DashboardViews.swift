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
    @State private var selectedBenchmarkId: String = ""
    @State private var benchmarkHistory: [String: [(date: Date, close: Double)]] = [:]
    @State private var benchmarkError: String?
    @State private var showHistoryOperations: Bool = true
    @State private var historyZoom: ClosedRange<Date>?
    @State private var historyPreset: HistoryPreset = .all
    @State private var hoverDate: Date?
    @State private var priceHistory: [String: [(date: Date, close: Double)]] = [:]
    @State private var cachedScope: ScopeResult?
    @State private var cachedHistoryRows: [HistoryRow] = []
    @State private var cachedChartRows: [ChartHistoryRow] = []
    @State private var isLoadingChart = false
    @State private var autoRefreshTask: Task<Void, Never>?

    var body: some View {
        let scope = cachedScope ?? emptyScope
        let historyRows = cachedHistoryRows
        let visibleDomain = historyZoom ?? defaultDomain(historyRows)
        let visibleRowsRaw = cachedChartRows.filter { $0.date >= visibleDomain.lowerBound && $0.date <= visibleDomain.upperBound }
        let visibleRows = dedupeChartRowsByDate(visibleRowsRaw)

        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                header()
                if let refreshError {
                    Text(refreshError).foregroundStyle(.red)
                }
                if let benchmarkError {
                    Text(benchmarkError).foregroundStyle(.red)
                }

                kpiRow(scope: scope)

                GroupBox("Alokacja (wg typu)") {
                    if scope.allocationByType.isEmpty {
                        ContentUnavailableView("Brak danych", systemImage: "chart.pie", description: Text("Dodaj operacje lub zaimportuj historię."))
                            .frame(maxWidth: .infinity, minHeight: 160)
                    } else {
                        let rows = allocationRows(scope)
                        InteractiveDonutChart(
                            slices: rows.map {
                                .init(id: $0.key, label: $0.label, value: $0.value, color: assetTypeColor($0.key))
                            },
                            valueCurrency: scope.baseCurrency,
                            centerIdleTitle: LWFormatting.money(rows.reduce(0) { $0 + $1.value }, currency: scope.baseCurrency),
                            centerIdleSubtitle: L10n.t("dashboard.allocation")
                        )
                        .padding(.top, 4)
                    }
                }

                GroupBox("Wartość i wkład (z benchmarkiem)") {
                    if visibleRows.isEmpty {
                        ContentUnavailableView("Brak danych", systemImage: "chart.line.uptrend.xyaxis", description: Text("Dodaj operacje lub zaimportuj historię."))
                            .frame(maxWidth: .infinity, minHeight: 180)
                    } else {
                        HStack {
                            Text("Benchmark").font(.caption).foregroundStyle(.secondary)
                            Picker("Benchmark", selection: $selectedBenchmarkId) {
                                ForEach(benchmarkOptions, id: \.id) { b in
                                    Text(b.label).tag(b.id)
                                }
                            }
                            .labelsHidden()
                            .pickerStyle(.menu)

                            Toggle("Operacje", isOn: $showHistoryOperations)
                                .toggleStyle(.checkbox)
                                .controlSize(.small)

                            Spacer()

                            Picker("Zakres", selection: $historyPreset) {
                                Text(L10n.t("history.all")).tag(HistoryPreset.all)
                                Text(L10n.t("history.1y")).tag(HistoryPreset.oneYear)
                                Text(L10n.t("history.quarter")).tag(HistoryPreset.quarter)
                                Text(L10n.t("history.ytd")).tag(HistoryPreset.ytd)
                            }
                            .labelsHidden()
                            .pickerStyle(.menu)
                            .onChange(of: historyPreset) { _, _ in
                                applyHistoryPreset(historyRows)
                            }

                            Text(domainLabel(visibleDomain))
                                .font(.caption)
                                .foregroundStyle(.secondary)

                            Button("-") { zoomOut(historyRows) }
                                .buttonStyle(.bordered)
                            Button("+") { zoomIn(historyRows) }
                                .buttonStyle(.bordered)
                            Button {
                                Task { await refreshChartFromUI() }
                            } label: {
                                if isLoadingChart {
                                    ProgressView().controlSize(.small)
                                } else {
                                    Image(systemName: "arrow.clockwise")
                                }
                            }
                            .buttonStyle(.bordered)
                            .disabled(isLoadingChart)
                            .help(L10n.t("dashboard.chartRefresh"))
                        }
                        .padding(.bottom, 8)

                        Chart {
                            ForEach(visibleRows) { row in
                                LineMark(
                                    x: .value("Data", row.date),
                                    y: .value("Wartość", row.value),
                                    series: .value("Seria", "Wartość portfela")
                                )
                                .foregroundStyle(Self.portfolioValueColor)
                                .interpolationMethod(.linear)
                                .lineStyle(StrokeStyle(lineWidth: 2.5))
                            }

                            ForEach(visibleRows) { row in
                                LineMark(
                                    x: .value("Data", row.date),
                                    y: .value("Wkład", row.invested),
                                    series: .value("Seria", "Wkład własny")
                                )
                                .foregroundStyle(Self.contributionColor)
                                .interpolationMethod(.stepEnd)
                                .lineStyle(StrokeStyle(lineWidth: 2.5))
                            }

                            if !selectedBenchmarkId.isEmpty {
                                ForEach(visibleRows.filter { $0.benchmark != nil }) { row in
                                    LineMark(
                                        x: .value("Data", row.date),
                                        y: .value("Benchmark", row.benchmark ?? 0),
                                        series: .value("Seria", "Benchmark")
                                    )
                                    .foregroundStyle(.gray)
                                    .interpolationMethod(.linear)
                                    .lineStyle(StrokeStyle(lineWidth: 2, dash: [6, 4]))
                                }
                            }

                            if let hovered = hoveredChartRow(visibleRows) {
                                RuleMark(x: .value("Data", hovered.date))
                                    .foregroundStyle(.secondary.opacity(0.5))
                                    .lineStyle(StrokeStyle(lineWidth: 1))
                                    .annotation(
                                        position: .top,
                                        spacing: 6,
                                        overflowResolution: .init(x: .fit(to: .chart), y: .fit(to: .chart))
                                    ) {
                                        chartTooltip(for: hovered, currency: scope.baseCurrency)
                                    }

                                PointMark(
                                    x: .value("Data", hovered.date),
                                    y: .value("Wartość", hovered.value)
                                )
                                .symbolSize(60)
                                .foregroundStyle(Self.portfolioValueColor)

                                PointMark(
                                    x: .value("Data", hovered.date),
                                    y: .value("Wkład", hovered.invested)
                                )
                                .symbolSize(60)
                                .foregroundStyle(Self.contributionColor)
                            }
                        }
                        .chartLegend(.hidden)
                        .chartXScale(domain: visibleDomain)
                        .chartOverlay { proxy in
                            GeometryReader { geo in
                                Rectangle()
                                    .fill(Color.clear)
                                    .contentShape(Rectangle())
                                    .onContinuousHover { phase in
                                        switch phase {
                                        case .active(let location):
                                            guard let plotAnchor = proxy.plotFrame else {
                                                hoverDate = nil
                                                return
                                            }
                                            let plotFrame = geo[plotAnchor]
                                            guard plotFrame.contains(location) else {
                                                hoverDate = nil
                                                return
                                            }
                                            hoverDate = proxy.value(atX: location.x - plotFrame.origin.x)
                                        case .ended:
                                            hoverDate = nil
                                        }
                                    }
                            }
                        }
                        .frame(height: 260)
                        .padding(.top, 4)

                        chartLegend(hasBenchmark: !selectedBenchmarkId.isEmpty && visibleRows.contains { $0.benchmark != nil })

                        if showHistoryOperations {
                            OperationsMarkerStrip(
                                markers: operationMarkers(domain: visibleDomain),
                                domain: visibleDomain
                            )
                            .padding(.top, 8)
                        }
                    }
                }

                GroupBox("Ekspozycja walutowa") {
                    if scope.allocationByCurrency.isEmpty {
                        ContentUnavailableView("Brak danych", systemImage: "dollarsign.circle", description: Text("Dodaj operacje lub zaimportuj historię."))
                            .frame(maxWidth: .infinity, minHeight: 160)
                    } else {
                        CurrencyExposureDonut(
                            rows: currencyRows(scope),
                            totalLabel: LWFormatting.money(currencyRows(scope).reduce(0) { $0 + $1.value }, currency: scope.baseCurrency),
                            currency: scope.baseCurrency
                        )
                    }
                }

                GroupBox(L10n.t("dashboard.profitChart")) {
                    let rows = profitRows(scope)
                    if rows.isEmpty {
                        ContentUnavailableView(L10n.t("dashboard.noData"), systemImage: "chart.bar")
                            .frame(maxWidth: .infinity, minHeight: 140)
                    } else {
                        Chart(rows) { row in
                            BarMark(
                                x: .value("Walor", row.symbol),
                                y: .value("Zysk", row.profit)
                            )
                            .foregroundStyle(row.profit >= 0 ? Color.green : Color.red)
                        }
                        .frame(height: 220)
                        .padding(.top, 8)
                    }
                }

                GroupBox(L10n.t("dashboard.portfolioCompare")) {
                    let rows = portfolioComparisonRows
                    if rows.isEmpty {
                        ContentUnavailableView(L10n.t("dashboard.noData"), systemImage: "rectangle.split.3x1")
                            .frame(maxWidth: .infinity, minHeight: 120)
                    } else {
                        VStack(spacing: 8) {
                            ForEach(rows) { row in
                                HStack {
                                    Circle().fill(Color(hex: row.colorHex) ?? .gray).frame(width: 10, height: 10)
                                    Text(row.name)
                                    Spacer()
                                    Text(LWFormatting.money(row.value, currency: row.currency))
                                    Text(LWFormatting.percent(row.returnPct))
                                        .foregroundStyle(row.returnPct >= 0 ? .green : .red)
                                        .frame(width: 72, alignment: .trailing)
                                }
                                Divider()
                            }
                        }
                        .padding(.top, 6)
                    }
                }
            }
            .padding()
        }
        .navigationTitle(L10n.t("nav.dashboard"))
        .id(appState.localizationEpoch)
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
            loadCachedHistories()
            if priceHistory.isEmpty {
                await refreshHistories()
            }
            await refreshChartData()
            startAutoRefreshLoop()
        }
        .task(id: chartRefreshToken) {
            await refreshChartData()
        }
        .task(id: selectedBenchmarkId) {
            await ensureBenchmarkHistory()
        }
        .onChange(of: appState.autoRefreshMinutes) { _, _ in
            startAutoRefreshLoop()
        }
        .onDisappear {
            autoRefreshTask?.cancel()
            autoRefreshTask = nil
        }
    }

    private func startAutoRefreshLoop() {
        autoRefreshTask?.cancel()
        let minutes = appState.autoRefreshMinutes
        guard minutes > 0 else { return }
        autoRefreshTask = Task {
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: UInt64(minutes) * 60 * 1_000_000_000)
                if Task.isCancelled { break }
                await refreshPrices(announce: false)
            }
        }
    }

    private func profitRows(_ scope: ScopeResult) -> [ProfitBarRow] {
        scope.positions
            .map { ProfitBarRow(symbol: $0.symbol, profit: $0.totalProfit) }
            .sorted { abs($0.profit) > abs($1.profit) }
            .prefix(12)
            .map { $0 }
    }

    private var portfolioComparisonRows: [PortfolioCompareRow] {
        portfolios.map { p in
            let s = PortfolioCalculator.calculate(
                portfolio: p,
                allTransactions: transactions,
                quotes: quotes,
                ratesToPLN: ratesToPLN
            )
            return PortfolioCompareRow(
                id: p.id,
                name: p.name,
                colorHex: p.colorHex,
                value: s.totalValueBase,
                returnPct: s.returnPct,
                currency: s.baseCurrency
            )
        }
        .sorted { $0.value > $1.value }
    }

    private func applyHistoryPreset(_ rows: [HistoryRow]) {
        let full = defaultDomain(rows)
        let cal = Calendar.current
        let end = full.upperBound
        switch historyPreset {
        case .all:
            historyZoom = full
        case .oneYear:
            let start = cal.date(byAdding: .year, value: -1, to: end) ?? full.lowerBound
            historyZoom = max(start, full.lowerBound) ... end
        case .quarter:
            let start = cal.date(byAdding: .month, value: -3, to: end) ?? full.lowerBound
            historyZoom = max(start, full.lowerBound) ... end
        case .ytd:
            let comps = cal.dateComponents([.year], from: end)
            let start = cal.date(from: comps) ?? full.lowerBound
            historyZoom = max(start, full.lowerBound) ... end
        }
    }

    private var emptyScope: ScopeResult {
        ScopeResult(
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

    private var chartRefreshToken: String {
        let pid = appState.selectedPortfolioId?.uuidString ?? ""
        let gid = appState.selectedGroupId?.uuidString ?? ""
        let quoteStamp = quotes.first?.asOf.timeIntervalSince1970 ?? 0
        let benchKeys = benchmarkHistory.keys.sorted().joined(separator: "|")
        return "\(pid)|\(gid)|\(transactions.count)|\(quoteStamp)|\(priceHistory.count)|\(benchKeys)|\(selectedBenchmarkId)"
    }

    private func refreshChartData() async {
        isLoadingChart = true
        defer { isLoadingChart = false }
        await Task.yield()

        let scope = dashboardScope
        let history = dashboardHistoryRows()
        let chart = attachBenchmarkSeries(history)

        cachedScope = scope
        cachedHistoryRows = history
        cachedChartRows = chart
    }

    private func refreshChartFromUI() async {
        isLoadingChart = true
        defer { isLoadingChart = false }

        let symbols = Set(transactions.compactMap { $0.symbol?.uppercased() }.filter { !$0.isEmpty })
        if !symbols.isEmpty {
            priceHistory = await PricingService.refreshHistories(symbols: Array(symbols))
        }

        await Task.yield()
        let scope = dashboardScope
        let history = dashboardHistoryRows()
        let chart = attachBenchmarkSeries(history)
        cachedScope = scope
        cachedHistoryRows = history
        cachedChartRows = chart

        historyPreset = .all
        historyZoom = defaultDomain(history)
        appState.notifySuccess(L10n.t("feedback.chartRefreshed"))
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
                    Label(L10n.t("dashboard.prices"), systemImage: "arrow.clockwise")
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

    private func refreshPrices(announce: Bool = true) async {
        isRefreshingPrices = true
        refreshError = nil
        defer { isRefreshingPrices = false }
        do {
            try await PricingService.refreshQuotes(for: transactions, context: context)
            await loadNBPRates()
            await refreshHistories()
            await ensureBenchmarkHistory()
            await refreshChartData()
            if announce {
                appState.notifySuccess(L10n.t("feedback.pricesRefreshed"))
            }
        } catch {
            refreshError = error.localizedDescription
            if announce {
                appState.notifyError(error.localizedDescription)
            }
        }
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
        appState.notifySuccess(L10n.t("feedback.positionDeleted", ["symbol": normSymbol]))
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

    private func currencyRows(_ scope: ScopeResult) -> [CurrencyRow] {
        scope.allocationByCurrency
            .map { CurrencyRow(currency: $0.key, value: $0.value) }
            .sorted { $0.value > $1.value }
    }

    private func dashboardHistoryRows() -> [HistoryRow] {
        let scoped = scopedPortfolios
        if scoped.count == 1, let p = scoped.first {
            return PortfolioCalculator.buildDailyTimeline(
                portfolio: p,
                allTransactions: transactions,
                quotes: quotes,
                histories: priceHistory
            )
        }
        return PortfolioCalculator.aggregateDailyTimelineToPLN(
            portfolios: scoped,
            allTransactions: transactions,
            quotes: quotes,
            ratesToPLN: ratesToPLN,
            histories: priceHistory
        )
    }

    private func loadCachedHistories() {
        let cached = PricingService.loadCachedHistories()
        if !cached.isEmpty { priceHistory = cached }
    }

    private func refreshHistories() async {
        let symbols = Set(transactions.compactMap { $0.symbol?.uppercased() }.filter { !$0.isEmpty })
        guard !symbols.isEmpty else { return }
        priceHistory = await PricingService.refreshHistories(symbols: Array(symbols))
        await refreshChartData()
    }

    private var benchmarkOptions: [BenchmarkOption] {
        let currency = cachedScope?.baseCurrency ?? "PLN"
        return [
            .init(id: "", label: "Brak", symbols: [], currency: currency, isComposite: false),
            .init(id: "wig", label: "WIG", symbols: ["ETFBW20TR.WA", "ETFBM40TR.WA"], currency: "PLN", isComposite: true),
            .init(id: "wig20", label: "WIG20", symbols: ["ETFBW20TR.WA"], currency: "PLN", isComposite: false),
            .init(id: "mwig40", label: "mWIG40", symbols: ["ETFBM40TR.WA"], currency: "PLN", isComposite: false),
            .init(id: "sp500", label: "S&P 500", symbols: ["^GSPC"], currency: "USD", isComposite: false),
            .init(id: "vwce", label: "VWCE", symbols: ["VWCE.DE"], currency: "EUR", isComposite: false),
        ]
    }

    private func isBenchmarkLoaded(_ cfg: BenchmarkOption) -> Bool {
        if cfg.isComposite {
            return cfg.symbols.allSatisfy { benchmarkHistory["\(cfg.id):\($0)"] != nil }
        }
        return benchmarkHistory[cfg.id] != nil
    }

    private func ensureBenchmarkHistory() async {
        benchmarkError = nil
        let id = selectedBenchmarkId
        guard let cfg = benchmarkOptions.first(where: { $0.id == id }), !cfg.id.isEmpty else { return }
        if isBenchmarkLoaded(cfg) { return }

        do {
            for sym in cfg.symbols {
                let h = try await PricingService.fetchHistory(symbol: sym)
                if cfg.isComposite {
                    benchmarkHistory["\(cfg.id):\(sym)"] = h
                } else {
                    benchmarkHistory[cfg.id] = h
                }
            }
        } catch {
            benchmarkError = error.localizedDescription
        }
    }

    private func attachBenchmarkSeries(_ rows: [HistoryRow]) -> [ChartHistoryRow] {
        guard !rows.isEmpty else { return [] }
        guard let cfg = benchmarkOptions.first(where: { $0.id == selectedBenchmarkId }), !cfg.id.isEmpty else {
            return rows.map { ChartHistoryRow(from: $0, benchmark: nil) }
        }

        var series = blendedBenchmarkSeries(cfg: cfg)
        if series.valuesByDayKey.isEmpty || series.sortedDayKeys.isEmpty {
            return rows.map { ChartHistoryRow(from: $0, benchmark: nil) }
        }

        var units = 0.0
        var prevInvested = 0.0
        var priceIndex = 0
        return rows.map { r in
            let price = series.priceAtOrBefore(dayKey: r.dayKey, index: &priceIndex)
            let invested = r.invested
            let delta = invested - prevInvested
            if abs(delta) > 0.005, price > 0 {
                units += delta / price
                if units < 0 { units = 0 }
                prevInvested = invested
            }
            let benchValue: Double? = {
                guard price > 0, units > 0 else { return nil }
                let value = units * price
                return value.isFinite ? value : nil
            }()
            return ChartHistoryRow(from: r, benchmark: benchValue)
        }
    }

    private struct BenchmarkSeries {
        let sortedDayKeys: [String]
        let valuesByDayKey: [String: Double]

        mutating func priceAtOrBefore(dayKey: String, index: inout Int) -> Double {
            guard !sortedDayKeys.isEmpty else { return 0 }
            if index < 0 { index = 0 }
            if index >= sortedDayKeys.count { index = sortedDayKeys.count - 1 }

            // Advance while next key is still <= requested key.
            while (index + 1) < sortedDayKeys.count, sortedDayKeys[index + 1] <= dayKey {
                index += 1
            }

            // If requested key is before our first known key, just use first value.
            if sortedDayKeys[index] > dayKey { index = 0 }
            return valuesByDayKey[sortedDayKeys[index]] ?? 0
        }
    }

    private func blendedBenchmarkSeries(cfg: BenchmarkOption) -> BenchmarkSeries {
        // Build a dayKey -> price(in scope currency) series.
        let df = DateFormatter()
        df.locale = Locale(identifier: "en_US_POSIX")
        df.dateFormat = "yyyy-MM-dd"

        func toScopeCurrency(_ amount: Double, currency: String) -> Double {
            let scope = (cachedScope?.baseCurrency ?? "PLN").uppercased()
            let ccy = currency.uppercased()
            if scope == ccy { return amount }
            // Approx: convert via today's NBP table A rates.
            let toPLN = PortfolioCalculator.convertToPLN(amount, currency: ccy, rates: ratesToPLN)
            if scope == "PLN" { return toPLN }
            let scopeRate = ratesToPLN[scope] ?? 0
            guard scopeRate > 0 else { return toPLN }
            return toPLN / scopeRate
        }

        if cfg.isComposite {
            let maps: [[String: Double]] = cfg.symbols.compactMap { sym in
                guard let h = benchmarkHistory["\(cfg.id):\(sym)"] else { return nil }
                var map: [String: Double] = [:]
                for row in h {
                    map[df.string(from: row.date)] = toScopeCurrency(row.close, currency: cfg.currency)
                }
                return map
            }
            return blendCompositeSeries(maps)
        } else {
            guard let h = benchmarkHistory[cfg.id] else { return BenchmarkSeries(sortedDayKeys: [], valuesByDayKey: [:]) }
            var map: [String: Double] = [:]
            for row in h {
                map[df.string(from: row.date)] = toScopeCurrency(row.close, currency: cfg.currency)
            }
            let keys = map.keys.sorted()
            return BenchmarkSeries(sortedDayKeys: keys, valuesByDayKey: map)
        }
    }

    private func blendCompositeSeries(_ maps: [[String: Double]]) -> BenchmarkSeries {
        guard !maps.isEmpty else { return BenchmarkSeries(sortedDayKeys: [], valuesByDayKey: [:]) }
        let allDates = Set(maps.flatMap { $0.keys })
        let dates = allDates.sorted()
        guard !dates.isEmpty else { return BenchmarkSeries(sortedDayKeys: [], valuesByDayKey: [:]) }

        // Turn each map into a sorted series for O(n) pointer-walk alignment.
        var series: [BenchmarkSeries] = maps.map { map in
            BenchmarkSeries(sortedDayKeys: map.keys.sorted(), valuesByDayKey: map)
        }

        // Normalize each series to its first available price, then average.
        var normalized: [[String: Double]] = Array(repeating: [:], count: series.count)
        var indices: [Int] = Array(repeating: 0, count: series.count)
        var starts: [Double] = Array(repeating: 0, count: series.count)

        for d in dates {
            for i in series.indices {
                var s = series[i]
                let v = s.priceAtOrBefore(dayKey: d, index: &indices[i])
                series[i] = s
                if starts[i] == 0, v > 0 { starts[i] = v }
                if starts[i] > 0, v > 0 {
                    normalized[i][d] = v / starts[i]
                }
            }
        }

        var blended: [String: Double] = [:]
        blended.reserveCapacity(dates.count)
        for d in dates {
            let vals = normalized.compactMap { $0[d] }.filter { $0 > 0 }
            if vals.count == maps.count {
                blended[d] = vals.reduce(0, +) / Double(vals.count)
            }
        }

        return BenchmarkSeries(sortedDayKeys: blended.keys.sorted(), valuesByDayKey: blended)
    }

    @ViewBuilder
    private func chartLegend(hasBenchmark: Bool) -> some View {
        HStack(spacing: 16) {
            chartLegendItem(color: Self.portfolioValueColor, label: "Wartość portfela")
            chartLegendItem(color: Self.contributionColor, label: "Wkład własny")
            if hasBenchmark {
                chartLegendItem(color: .gray, label: "Benchmark", dashed: true)
            }
        }
        .font(.caption)
        .padding(.top, 4)
    }

    private func chartLegendItem(color: Color, label: String, dashed: Bool = false) -> some View {
        HStack(spacing: 6) {
            if dashed {
                Capsule()
                    .stroke(color, style: StrokeStyle(lineWidth: 2, dash: [4, 3]))
                    .frame(width: 18, height: 2)
            } else {
                Capsule()
                    .fill(color)
                    .frame(width: 18, height: 3)
            }
            Text(label)
                .foregroundStyle(.secondary)
        }
    }

    private static let portfolioValueColor = Color(red: 0.18, green: 0.45, blue: 0.36)
    private static let contributionColor = Color(red: 0.64, green: 0.44, blue: 0.12)

    private func hoveredChartRow(_ rows: [ChartHistoryRow]) -> ChartHistoryRow? {
        guard let target = hoverDate, !rows.isEmpty else { return nil }
        return rows.min {
            abs($0.date.timeIntervalSince(target)) < abs($1.date.timeIntervalSince(target))
        }
    }

    @ViewBuilder
    private func chartTooltip(for row: ChartHistoryRow, currency: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(row.dayKey)
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
            tooltipLine(color: Self.portfolioValueColor, label: "Wartość portfela", value: LWFormatting.money(row.value, currency: currency))
            tooltipLine(color: Self.contributionColor, label: "Wkład własny", value: LWFormatting.money(row.invested, currency: currency))
            if let b = row.benchmark {
                tooltipLine(color: .gray, label: "Benchmark", value: LWFormatting.money(b, currency: currency))
            }
            if row.invested > 0 {
                let profitPct = (row.value - row.invested) / row.invested * 100
                HStack(spacing: 6) {
                    Image(systemName: profitPct >= 0 ? "arrow.up.right" : "arrow.down.right")
                        .font(.caption2.weight(.bold))
                    Text("Zysk/strata")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Spacer(minLength: 12)
                    Text(LWFormatting.percent(profitPct))
                        .font(.caption.weight(.semibold))
                        .monospacedDigit()
                }
                .foregroundStyle(profitPct >= 0 ? Color.green : Color.red)
            }
        }
        .padding(8)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 8))
        .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(.quaternary))
    }

    private func tooltipLine(color: Color, label: String, value: String) -> some View {
        HStack(spacing: 6) {
            Circle().fill(color).frame(width: 8, height: 8)
            Text(label).font(.caption).foregroundStyle(.secondary)
            Spacer(minLength: 12)
            Text(value).font(.caption.weight(.semibold)).monospacedDigit()
        }
    }

    private func defaultDomain(_ rows: [HistoryRow]) -> ClosedRange<Date> {
        let cal = Calendar.current
        let start = rows.first?.date ?? cal.startOfDay(for: Date())
        let end = rows.last?.date ?? cal.startOfDay(for: Date())
        return start ... end
    }

    private func domainLabel(_ domain: ClosedRange<Date>) -> String {
        let df = DateFormatter()
        df.locale = Locale(identifier: "en_US_POSIX")
        df.dateFormat = "yyyy-MM-dd"
        return "\(df.string(from: domain.lowerBound)) – \(df.string(from: domain.upperBound))"
    }

    private func zoomIn(_ rows: [HistoryRow]) {
        let full = defaultDomain(rows)
        let current = historyZoom ?? full
        let center = current.lowerBound.timeIntervalSince1970 + (current.upperBound.timeIntervalSince1970 - current.lowerBound.timeIntervalSince1970) / 2
        let half = max(86400.0 * 7, (current.upperBound.timeIntervalSince1970 - current.lowerBound.timeIntervalSince1970) * 0.35)
        let newStart = Date(timeIntervalSince1970: center - half).clamped(to: full)
        let newEnd = Date(timeIntervalSince1970: center + half).clamped(to: full)
        historyZoom = newStart ... newEnd
    }

    private func zoomOut(_ rows: [HistoryRow]) {
        let full = defaultDomain(rows)
        let current = historyZoom ?? full
        let center = current.lowerBound.timeIntervalSince1970 + (current.upperBound.timeIntervalSince1970 - current.lowerBound.timeIntervalSince1970) / 2
        let half = min((full.upperBound.timeIntervalSince1970 - full.lowerBound.timeIntervalSince1970) / 2,
                       (current.upperBound.timeIntervalSince1970 - current.lowerBound.timeIntervalSince1970) * 0.7)
        let newStart = Date(timeIntervalSince1970: center - half).clamped(to: full)
        let newEnd = Date(timeIntervalSince1970: center + half).clamped(to: full)
        historyZoom = newStart ... newEnd
    }

    private func operationMarkers(domain: ClosedRange<Date>) -> [OperationMarker] {
        let scopedIds = Set(scopedPortfolios.map { $0.id })
        let scopedTx = transactions.filter { tx in
            guard let pid = tx.portfolio?.id, scopedIds.contains(pid) else { return false }
            return tx.date >= domain.lowerBound && tx.date <= domain.upperBound
        }
        let cal = Calendar.current
        let df = DateFormatter()
        df.locale = Locale(identifier: "en_US_POSIX")
        df.dateFormat = "yyyy-MM-dd"

        let significant: Set<String> = ["deposit", "withdrawal", "buy", "sell", "transfer"]
        var grouped: [String: [String: Int]] = [:]

        for tx in scopedTx {
            guard significant.contains(tx.typeRaw) else { continue }
            let day = cal.startOfDay(for: tx.date)
            let key = df.string(from: day)
            grouped[key, default: [:]][tx.typeRaw, default: 0] += 1
        }

        return grouped
            .compactMap { (key, counts) in
                guard let date = df.date(from: key) else { return nil }
                return OperationMarker(dayKey: key, date: date, counts: counts)
            }
            .sorted { $0.date < $1.date }
    }

    private func dedupeChartRowsByDate(_ rows: [ChartHistoryRow]) -> [ChartHistoryRow] {
        var byDay: [String: ChartHistoryRow] = [:]
        for row in rows {
            byDay[row.dayKey] = row
        }
        return byDay.values.sorted { $0.date < $1.date }
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

private func assetTypeColor(_ key: String) -> Color {
    switch key {
    case "etf": return Color(red: 0.18, green: 0.52, blue: 0.72)
    case "stock": return Color(red: 0.82, green: 0.32, blue: 0.28)
    case "bond": return Color(red: 0.52, green: 0.38, blue: 0.72)
    case "cash": return Color(red: 0.20, green: 0.62, blue: 0.42)
    case "other": return Color(red: 0.45, green: 0.48, blue: 0.52)
    default: return .gray
    }
}

private struct CurrencyRow: Identifiable {
    var id: String { currency }
    let currency: String
    let value: Double
}

private struct InteractiveDonutSlice: Identifiable {
    let id: String
    let label: String
    let value: Double
    let color: Color
}

private struct InteractiveDonutChart: View {
    let slices: [InteractiveDonutSlice]
    let valueCurrency: String
    var centerIdleTitle: String? = nil
    var centerIdleSubtitle: String? = nil
    var showsLegend: Bool = true
    var chartHeight: CGFloat = 230
    var innerRatio: CGFloat = 0.58

    @State private var hoveredID: String?
    @State private var selectedValue: Double?

    private var total: Double { max(0.000001, slices.reduce(0) { $0 + $1.value }) }

    private var hoveredSlice: InteractiveDonutSlice? {
        guard let hoveredID else { return nil }
        return slices.first(where: { $0.id == hoveredID })
    }

    var body: some View {
        VStack(spacing: 14) {
            ZStack {
                Chart(slices) { slice in
                    let isHot = hoveredID == slice.id
                    SectorMark(
                        angle: .value("Wartość", slice.value),
                        innerRadius: .ratio(innerRatio),
                        outerRadius: .ratio(isHot ? 1.0 : 0.88),
                        angularInset: isHot ? 0.8 : 1.8
                    )
                    .cornerRadius(isHot ? 7 : 4)
                    .foregroundStyle(slice.color)
                    .opacity(hoveredID == nil || isHot ? 1.0 : 0.42)
                    .shadow(color: isHot ? Color.black.opacity(0.28) : .clear, radius: isHot ? 7 : 0, y: isHot ? 3 : 0)
                }
                .chartLegend(.hidden)
                .chartAngleSelection(value: $selectedValue)
                .animation(.spring(response: 0.28, dampingFraction: 0.76), value: hoveredID)
                .frame(height: chartHeight)
                .chartOverlay { proxy in
                    GeometryReader { geo in
                        let plot = proxy.plotFrame.map { geo[$0] } ?? geo.frame(in: .local)
                        Rectangle()
                            .fill(Color.clear)
                            .contentShape(Rectangle())
                            .onContinuousHover { phase in
                                switch phase {
                                case .active(let point):
                                    updateHover(at: point, plotFrame: plot)
                                case .ended:
                                    hoveredID = nil
                                    selectedValue = nil
                                }
                            }
                    }
                }
                .onChange(of: selectedValue) { _, newValue in
                    guard let newValue else { return }
                    hoveredID = sliceID(containing: newValue)
                }

                // Soft outline ring for the active slice
                if let hot = hoveredSlice {
                    DonutSliceOutline(
                        slices: slices,
                        highlightedID: hot.id,
                        innerRatio: innerRatio,
                        outerRatio: 1.0
                    )
                    .frame(height: chartHeight)
                    .allowsHitTesting(false)
                }

                VStack(spacing: 4) {
                    if let hot = hoveredSlice {
                        Text(hot.label)
                            .font(.headline.weight(.semibold))
                        Text(formatSharePercent((hot.value / total) * 100))
                            .font(.title2.weight(.bold))
                            .foregroundStyle(hot.color)
                        Text(LWFormatting.money(hot.value, currency: valueCurrency))
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    } else {
                        if let centerIdleTitle {
                            Text(centerIdleTitle)
                                .font(.title3.weight(.bold))
                                .multilineTextAlignment(.center)
                        }
                        if let centerIdleSubtitle {
                            Text(centerIdleSubtitle)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                                .multilineTextAlignment(.center)
                        }
                    }
                }
                .padding(.horizontal, 28)
                .animation(.easeInOut(duration: 0.15), value: hoveredID)
            }

            if showsLegend {
                VStack(alignment: .center, spacing: 8) {
                    ForEach(slices.sorted(by: { $0.value > $1.value })) { slice in
                        let pct = (slice.value / total) * 100
                        let isHot = hoveredID == slice.id
                        HStack(spacing: 10) {
                            Circle()
                                .fill(slice.color)
                                .frame(width: 10, height: 10)
                                .overlay {
                                    if isHot {
                                        Circle().strokeBorder(Color.primary.opacity(0.55), lineWidth: 1.5)
                                    }
                                }
                            Text(slice.label)
                                .font(.subheadline.weight(isHot ? .semibold : .regular))
                                .frame(minWidth: 72, alignment: .leading)
                            Text(formatSharePercent(pct))
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                                .frame(width: 70, alignment: .leading)
                            Text(LWFormatting.money(slice.value, currency: valueCurrency))
                                .font(.subheadline)
                                .foregroundStyle(isHot ? .primary : .secondary)
                                .frame(minWidth: 120, alignment: .trailing)
                        }
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .background(
                            RoundedRectangle(cornerRadius: 6, style: .continuous)
                                .fill(isHot ? slice.color.opacity(0.12) : Color.clear)
                        )
                        .overlay(
                            RoundedRectangle(cornerRadius: 6, style: .continuous)
                                .strokeBorder(isHot ? slice.color.opacity(0.45) : Color.clear, lineWidth: 1)
                        )
                        .contentShape(Rectangle())
                        .onHover { inside in
                            hoveredID = inside ? slice.id : (hoveredID == slice.id ? nil : hoveredID)
                        }
                    }
                }
                .frame(maxWidth: 420)
            }
        }
        .padding(.top, 4)
    }

    private func updateHover(at point: CGPoint, plotFrame: CGRect) {
        let center = CGPoint(x: plotFrame.midX, y: plotFrame.midY)
        let dx = point.x - center.x
        let dy = point.y - center.y
        let radius = sqrt(dx * dx + dy * dy)
        let outer = min(plotFrame.width, plotFrame.height) / 2
        let inner = outer * innerRatio
        // Allow a bit of slack for the elevated slice.
        guard radius >= inner * 0.82, radius <= outer * 1.08 else {
            hoveredID = nil
            selectedValue = nil
            return
        }

        // Swift Charts SectorMark starts at top and goes clockwise.
        var degrees = atan2(dx, -dy) * 180 / .pi
        if degrees < 0 { degrees += 360 }
        let value = (degrees / 360) * total
        selectedValue = value
        hoveredID = sliceID(containing: value)
    }

    private func sliceID(containing value: Double) -> String? {
        var cumulative = 0.0
        for slice in slices {
            cumulative += slice.value
            if value <= cumulative + 0.000_001 {
                return slice.id
            }
        }
        return slices.last?.id
    }

    private func formatSharePercent(_ value: Double) -> String {
        let formatter = NumberFormatter()
        formatter.locale = .current
        formatter.numberStyle = .decimal
        formatter.minimumFractionDigits = 1
        formatter.maximumFractionDigits = 1
        let str = formatter.string(from: NSNumber(value: value)) ?? String(format: "%.1f", value)
        return "\(str)%"
    }
}

/// Vector outline matching the hovered donut slice (lift + rounded stroke).
private struct DonutSliceOutline: View {
    let slices: [InteractiveDonutSlice]
    let highlightedID: String
    let innerRatio: CGFloat
    let outerRatio: CGFloat
    /// Matches `SectorMark.cornerRadius` used for the hot slice.
    var cornerRadius: CGFloat = 7

    var body: some View {
        Canvas { context, size in
            let total = max(0.000001, slices.reduce(0) { $0 + $1.value })
            guard let index = slices.firstIndex(where: { $0.id == highlightedID }) else { return }

            var startFraction = 0.0
            for i in 0..<index {
                startFraction += slices[i].value / total
            }
            let endFraction = startFraction + slices[index].value / total

            let center = CGPoint(x: size.width / 2, y: size.height / 2)
            let outer = min(size.width, size.height) / 2 * outerRatio
            let inner = min(size.width, size.height) / 2 * innerRatio * 0.98

            // Slight inset to follow SectorMark angularInset on the hot slice.
            let insetFraction = min(0.004, (endFraction - startFraction) * 0.08)
            let start = Angle.degrees((startFraction + insetFraction) * 360 - 90)
            let end = Angle.degrees((endFraction - insetFraction) * 360 - 90)

            let path = roundedAnnularSectorPath(
                center: center,
                innerRadius: inner,
                outerRadius: outer,
                startAngle: start,
                endAngle: end,
                cornerRadius: cornerRadius
            )

            context.stroke(
                path,
                with: .color(.primary.opacity(0.7)),
                style: StrokeStyle(lineWidth: 2.0, lineCap: .round, lineJoin: .round)
            )
            context.stroke(
                path,
                with: .color(slices[index].color.opacity(0.95)),
                style: StrokeStyle(lineWidth: 1.15, lineCap: .round, lineJoin: .round)
            )
        }
        .animation(.spring(response: 0.28, dampingFraction: 0.76), value: highlightedID)
    }
}

/// Annular sector with filleted corners (matches Swift Charts `SectorMark` cornerRadius look).
private func roundedAnnularSectorPath(
    center: CGPoint,
    innerRadius: CGFloat,
    outerRadius: CGFloat,
    startAngle: Angle,
    endAngle: Angle,
    cornerRadius: CGFloat
) -> Path {
    let a0 = startAngle.radians
    let a1 = endAngle.radians
    let span = a1 - a0

    func polar(_ angle: Double, _ radius: CGFloat) -> CGPoint {
        CGPoint(
            x: center.x + CGFloat(cos(angle)) * radius,
            y: center.y + CGFloat(sin(angle)) * radius
        )
    }

    func sharpPath() -> Path {
        var path = Path()
        path.addArc(center: center, radius: outerRadius, startAngle: startAngle, endAngle: endAngle, clockwise: false)
        path.addArc(center: center, radius: innerRadius, startAngle: endAngle, endAngle: startAngle, clockwise: true)
        path.closeSubpath()
        return path
    }

    guard span > 0.025 else { return sharpPath() }

    let cr = min(
        cornerRadius,
        (outerRadius - innerRadius) / 2.15,
        CGFloat(span) * innerRadius / 2.4
    )
    guard cr >= 0.8 else { return sharpPath() }

    let oOff = Double(cr / outerRadius)
    let iOff = Double(cr / innerRadius)
    guard span > (oOff + iOff) * 2.1 else { return sharpPath() }

    var path = Path()
    path.move(to: polar(a0 + oOff, outerRadius))
    path.addArc(
        center: center,
        radius: outerRadius,
        startAngle: .radians(a0 + oOff),
        endAngle: .radians(a1 - oOff),
        clockwise: false
    )
    // Outer → end radial
    path.addQuadCurve(to: polar(a1, outerRadius - cr), control: polar(a1, outerRadius))
    path.addLine(to: polar(a1, innerRadius + cr))
    // End radial → inner
    path.addQuadCurve(to: polar(a1 - iOff, innerRadius), control: polar(a1, innerRadius))
    path.addArc(
        center: center,
        radius: innerRadius,
        startAngle: .radians(a1 - iOff),
        endAngle: .radians(a0 + iOff),
        clockwise: true
    )
    // Inner → start radial
    path.addQuadCurve(to: polar(a0, innerRadius + cr), control: polar(a0, innerRadius))
    path.addLine(to: polar(a0, outerRadius - cr))
    // Start radial → outer
    path.addQuadCurve(to: polar(a0 + oOff, outerRadius), control: polar(a0, outerRadius))
    path.closeSubpath()
    return path
}

private struct CurrencyExposureDonut: View {
    let rows: [CurrencyRow]
    let totalLabel: String
    let currency: String

    var body: some View {
        InteractiveDonutChart(
            slices: rows.map {
                .init(id: $0.currency, label: $0.currency, value: $0.value, color: currencyColor($0.currency))
            },
            valueCurrency: currency,
            centerIdleTitle: totalLabel,
            centerIdleSubtitle: "Ekspozycja walutowa",
            showsLegend: true,
            innerRatio: 0.62
        )
    }

    private func currencyColor(_ code: String) -> Color {
        switch code.uppercased() {
        case "USD": return Color(red: 0.64, green: 0.44, blue: 0.12)
        case "PLN": return Color(red: 0.09, green: 0.42, blue: 0.30)
        case "EUR": return Color(red: 0.11, green: 0.33, blue: 0.67)
        default: return .gray
        }
    }
}

private struct BenchmarkOption: Identifiable, Hashable {
    let id: String
    let label: String
    let symbols: [String]
    let currency: String
    let isComposite: Bool
}

private struct ChartHistoryRow: Identifiable, Hashable {
    var id: String { dayKey }
    let date: Date
    let dayKey: String
    let value: Double
    let invested: Double
    let benchmark: Double?

    init(from row: HistoryRow, benchmark: Double?) {
        self.date = row.date
        self.dayKey = row.dayKey
        self.value = row.value
        self.invested = row.invested
        self.benchmark = benchmark
    }
}

private struct OperationMarker: Identifiable, Hashable {
    var id: String { dayKey }
    let dayKey: String
    let date: Date
    let counts: [String: Int]

    var total: Int { counts.values.reduce(0, +) }
}

private struct OperationsMarkerStrip: View {
    let markers: [OperationMarker]
    let domain: ClosedRange<Date>

    var body: some View {
        Chart(markers) { marker in
            PointMark(
                x: .value("Data", marker.date),
                y: .value("Y", 1)
            )
            .symbolSize(70)
            .foregroundStyle(color(for: marker))
            .annotation(position: .top, alignment: .center) {
                if marker.total > 0 {
                    Text("\(marker.total)")
                        .font(.caption2.weight(.bold))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 3)
                        .background(Capsule().fill(color(for: marker)))
                }
            }
        }
        .chartXScale(domain: domain)
        .chartYScale(domain: 0 ... 2)
        .chartYAxis(.hidden)
        .chartXAxis(.hidden)
        .frame(height: 36)
    }

    private func color(for marker: OperationMarker) -> Color {
        // If any withdrawal, mark red; else if any deposit, green; else neutral.
        if (marker.counts["withdrawal"] ?? 0) > 0 { return .red }
        if (marker.counts["deposit"] ?? 0) > 0 { return .green }
        if (marker.counts["buy"] ?? 0) > 0 || (marker.counts["sell"] ?? 0) > 0 { return .gray }
        return .gray
    }
}

private extension Date {
    func clamped(to range: ClosedRange<Date>) -> Date {
        if self < range.lowerBound { return range.lowerBound }
        if self > range.upperBound { return range.upperBound }
        return self
    }
}

private enum HistoryPreset: String, CaseIterable, Hashable {
    case all
    case oneYear
    case quarter
    case ytd
}

private struct ProfitBarRow: Identifiable {
    var id: String { symbol }
    let symbol: String
    let profit: Double
}

private struct PortfolioCompareRow: Identifiable {
    let id: UUID
    let name: String
    let colorHex: String
    let value: Double
    let returnPct: Double
    let currency: String
}

private enum DashboardScope: Hashable {
    case all
    case group(UUID)
    case portfolio(UUID)
}
