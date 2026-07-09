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
    @State private var hoverDate: Date?
    @State private var priceHistory: [String: [(date: Date, close: Double)]] = [:]

    var body: some View {
        let scope = dashboardScope
        let historyRows = dashboardHistoryRows()
        let chartRows = attachBenchmarkSeries(historyRows)
        let visibleDomain = historyZoom ?? defaultDomain(historyRows)
        let visibleRowsRaw = chartRows.filter { $0.date >= visibleDomain.lowerBound && $0.date <= visibleDomain.upperBound }
        let visibleRows = compressChartRows(visibleRowsRaw)

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
                        Chart(allocationRows(scope)) { row in
                            SectorMark(
                                angle: .value("Wartość", row.value),
                                innerRadius: .ratio(0.55)
                            )
                            .foregroundStyle(by: .value("Typ", row.label))
                        }
                        .frame(height: 220)
                        .padding(.top, 8)
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

                            Text(domainLabel(visibleDomain))
                                .font(.caption)
                                .foregroundStyle(.secondary)

                            Button("-") { zoomOut(historyRows) }
                                .buttonStyle(.bordered)
                            Button("+") { zoomIn(historyRows) }
                                .buttonStyle(.bordered)
                            Button {
                                historyZoom = defaultDomain(historyRows)
                            } label: {
                                Image(systemName: "arrow.counterclockwise")
                            }
                            .buttonStyle(.bordered)
                        }
                        .padding(.bottom, 8)

                        Chart {
                            ForEach(visibleRows) { row in
                                LineMark(
                                    x: .value("Data", row.date),
                                    y: .value("Wartość", row.value),
                                    series: .value("Seria", "Wartość portfela")
                                )
                                .foregroundStyle(by: .value("Seria", "Wartość portfela"))
                                .interpolationMethod(.linear)
                                .lineStyle(StrokeStyle(lineWidth: 2.5))

                                LineMark(
                                    x: .value("Data", row.date),
                                    y: .value("Wkład", row.invested),
                                    series: .value("Seria", "Wkład własny")
                                )
                                .foregroundStyle(by: .value("Seria", "Wkład własny"))
                                .interpolationMethod(.stepEnd)
                                .lineStyle(StrokeStyle(lineWidth: 2.5))

                                if let b = row.benchmark {
                                    LineMark(
                                        x: .value("Data", row.date),
                                        y: .value("Benchmark", b),
                                        series: .value("Seria", "Benchmark")
                                    )
                                    .foregroundStyle(by: .value("Seria", "Benchmark"))
                                    .lineStyle(StrokeStyle(lineWidth: 2, dash: [6, 4]))
                                    .interpolationMethod(.linear)
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
                        .chartForegroundStyleScale(
                            domain: chartSeriesDomain(visibleRows),
                            range: chartSeriesColors(visibleRows)
                        )
                        .chartLegend(position: .bottom, alignment: .leading, spacing: 8)
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
            loadCachedHistories()
            if priceHistory.isEmpty {
                await refreshHistories()
            }
        }
        .task(id: selectedBenchmarkId) {
            await ensureBenchmarkHistory()
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
            await refreshHistories()
            await ensureBenchmarkHistory()
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
    }

    private var benchmarkOptions: [BenchmarkOption] {
        [
            .init(id: "", label: "Brak", symbols: [], currency: scopeCurrency, isComposite: false),
            .init(id: "wig", label: "WIG", symbols: ["ETFBW20TR.WA", "ETFBM40TR.WA"], currency: "PLN", isComposite: true),
            .init(id: "wig20", label: "WIG20", symbols: ["ETFBW20TR.WA"], currency: "PLN", isComposite: false),
            .init(id: "mwig40", label: "mWIG40", symbols: ["ETFBM40TR.WA"], currency: "PLN", isComposite: false),
            .init(id: "sp500", label: "S&P 500", symbols: ["^GSPC"], currency: "USD", isComposite: false),
            .init(id: "vwce", label: "VWCE", symbols: ["VWCE.DE"], currency: "EUR", isComposite: false),
        ]
    }

    private var scopeCurrency: String {
        dashboardScope.baseCurrency
    }

    private func ensureBenchmarkHistory() async {
        benchmarkError = nil
        let id = selectedBenchmarkId
        guard let cfg = benchmarkOptions.first(where: { $0.id == id }), !cfg.id.isEmpty else { return }
        if benchmarkHistory[cfg.id] != nil { return }

        do {
            var merged: [Date: Double] = [:]
            for sym in cfg.symbols {
                let h = try await PricingService.fetchHistory(symbol: sym)
                if cfg.isComposite {
                    // For composite, store per symbol separately; we'll blend later.
                    benchmarkHistory["\(cfg.id):\(sym)"] = h
                } else {
                    benchmarkHistory[cfg.id] = h
                }
                _ = merged
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

        let priceMap: [String: Double] = blendedBenchmarkPrices(cfg: cfg)
        if priceMap.isEmpty {
            return rows.map { ChartHistoryRow(from: $0, benchmark: nil) }
        }

        var units = 0.0
        var prevInvested = 0.0
        return rows.map { r in
            let price = priceAtOrBefore(priceMap, dayKey: r.dayKey)
            let invested = r.invested
            let delta = invested - prevInvested
            if abs(delta) > 0.005, price > 0 {
                units += delta / price
                if units < 0 { units = 0 }
                prevInvested = invested
            }
            let benchValue = (price > 0 && units > 0) ? units * price : nil
            return ChartHistoryRow(from: r, benchmark: benchValue)
        }
    }

    private func blendedBenchmarkPrices(cfg: BenchmarkOption) -> [String: Double] {
        // Build a dateKey -> price(in scope currency) map
        let df = DateFormatter()
        df.locale = Locale(identifier: "en_US_POSIX")
        df.dateFormat = "yyyy-MM-dd"

        func toScopeCurrency(_ amount: Double, currency: String) -> Double {
            let scope = scopeCurrency.uppercased()
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
            let series: [[String: Double]] = cfg.symbols.compactMap { sym in
                guard let h = benchmarkHistory["\(cfg.id):\(sym)"] else { return nil }
                var map: [String: Double] = [:]
                for row in h {
                    map[df.string(from: row.date)] = toScopeCurrency(row.close, currency: cfg.currency)
                }
                return map
            }
            return blendComposite(series)
        } else {
            guard let h = benchmarkHistory[cfg.id] else { return [:] }
            var map: [String: Double] = [:]
            for row in h {
                map[df.string(from: row.date)] = toScopeCurrency(row.close, currency: cfg.currency)
            }
            return map
        }
    }

    private func blendComposite(_ maps: [[String: Double]]) -> [String: Double] {
        guard !maps.isEmpty else { return [:] }
        let allDates = Set(maps.flatMap { $0.keys })
        let dates = allDates.sorted()
        guard !dates.isEmpty else { return [:] }

        // Normalize each series to its first available price, then average.
        let normalized: [[String: Double]] = maps.map { map in
            var start: Double = 0
            var out: [String: Double] = [:]
            for d in dates {
                let v = priceAtOrBefore(map, dayKey: d)
                if start == 0, v > 0 { start = v }
                if start > 0, v > 0 { out[d] = v / start }
            }
            return out
        }

        var blended: [String: Double] = [:]
        for d in dates {
            let vals = normalized.compactMap { $0[d] }.filter { $0 > 0 }
            if vals.count == maps.count {
                blended[d] = vals.reduce(0, +) / Double(vals.count)
            }
        }
        return blended
    }

    private func priceAtOrBefore(_ map: [String: Double], dayKey: String) -> Double {
        if let v = map[dayKey], v > 0 { return v }
        // Find nearest previous date key. Map sizes are small, linear scan ok.
        let candidates = map.keys.filter { $0 <= dayKey }.sorted()
        guard let last = candidates.last else { return 0 }
        return map[last] ?? 0
    }

    private static let portfolioValueColor = Color(red: 0.18, green: 0.45, blue: 0.36)
    private static let contributionColor = Color(red: 0.64, green: 0.44, blue: 0.12)

    private func chartSeriesDomain(_ rows: [ChartHistoryRow]) -> [String] {
        var domain = ["Wartość portfela", "Wkład własny"]
        if rows.contains(where: { $0.benchmark != nil }) {
            domain.append("Benchmark")
        }
        return domain
    }

    private func chartSeriesColors(_ rows: [ChartHistoryRow]) -> [Color] {
        var colors = [Self.portfolioValueColor, Self.contributionColor]
        if rows.contains(where: { $0.benchmark != nil }) {
            colors.append(.gray)
        }
        return colors
    }

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

    private func compressChartRows(_ rows: [ChartHistoryRow]) -> [ChartHistoryRow] {
        guard rows.count >= 3 else { return rows }
        let sorted = rows.sorted { $0.date < $1.date }

        var out: [ChartHistoryRow] = []
        out.reserveCapacity(min(sorted.count, 400))

        var prev = sorted[0]
        out.append(prev)

        // Keep only meaningful changes to avoid jagged rendering when values are constant.
        let valueEps = 0.01
        let investedEps = 0.005
        let maxSpacing: TimeInterval = 86400 * 14 // keep at least one point every 2 weeks
        var lastKeptDate = prev.date

        for row in sorted.dropFirst().dropLast() {
            let valueDelta = abs(row.value - prev.value)
            let investedDelta = abs(row.invested - prev.invested)
            let timeDelta = row.date.timeIntervalSince(lastKeptDate)

            if valueDelta > valueEps || investedDelta > investedEps || timeDelta >= maxSpacing {
                out.append(row)
                prev = row
                lastKeptDate = row.date
            }
        }

        if let last = sorted.last {
            out.append(last)
        }

        return out
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

private struct CurrencyRow: Identifiable {
    var id: String { currency }
    let currency: String
    let value: Double
}

private struct CurrencyExposureDonut: View {
    let rows: [CurrencyRow]
    let totalLabel: String
    let currency: String

    var body: some View {
        let total = max(0.000001, rows.reduce(0) { $0 + $1.value })

        VStack(spacing: 12) {
            ZStack {
                Chart(rows) { row in
                    SectorMark(
                        angle: .value("Wartość", row.value),
                        innerRadius: .ratio(0.62)
                    )
                    .foregroundStyle(currencyColor(row.currency))
                }
                .chartLegend(.hidden)
                .frame(height: 220)

                VStack(spacing: 4) {
                    Text(totalLabel)
                        .font(.title2.weight(.bold))
                    Text("Ekspozycja walutowa")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }

            VStack(alignment: .center, spacing: 10) {
                ForEach(rows.sorted(by: { $0.value > $1.value })) { row in
                    let pct = (row.value / total) * 100
                    HStack(spacing: 10) {
                        Circle()
                            .fill(currencyColor(row.currency))
                            .frame(width: 10, height: 10)
                        Text(row.currency)
                            .font(.subheadline.weight(.semibold))
                            .frame(width: 44, alignment: .leading)
                        Text(formatSharePercent(pct))
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                            .frame(width: 70, alignment: .leading)
                        Text(LWFormatting.money(row.value, currency: currency))
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                            .frame(width: 140, alignment: .trailing)
                    }
                }
            }
            .frame(maxWidth: 360, alignment: .center)
        }
        .padding(.top, 8)
    }

    private func formatSharePercent(_ value: Double) -> String {
        let formatter = NumberFormatter()
        formatter.locale = .current
        formatter.numberStyle = .decimal
        formatter.minimumFractionDigits = 2
        formatter.maximumFractionDigits = 2
        let str = formatter.string(from: NSNumber(value: value)) ?? String(format: "%.2f", value)
        return "\(str)%"
    }

    private func currencyColor(_ code: String) -> Color {
        switch code.uppercased() {
        case "USD": return Color(red: 0.64, green: 0.44, blue: 0.12) // brown-ish
        case "PLN": return Color(red: 0.09, green: 0.42, blue: 0.30) // green-ish
        case "EUR": return Color(red: 0.11, green: 0.33, blue: 0.67) // blue-ish
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

