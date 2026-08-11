import SwiftUI
import SwiftData

private enum RebalanceScope: Hashable {
    case all
    case group(UUID)
    case portfolio(UUID)
}

struct RebalanceView: View {
    @Environment(\.modelContext) private var context
    @EnvironmentObject private var appState: AppState

    @Query(sort: \Portfolio.createdAt) private var portfolios: [Portfolio]
    @Query(sort: \PortfolioGroup.createdAt) private var groups: [PortfolioGroup]
    @Query(sort: \Transaction.date) private var transactions: [Transaction]
    @Query(sort: \AllocationTarget.createdAt) private var targets: [AllocationTarget]
    @Query(sort: \Quote.asOf, order: .reverse) private var quotes: [Quote]

    @State private var scope: RebalanceScope = .all
    @State private var ratesToPLN: [String: Double] = NBPExchangeRateService.cachedRatesToPLN()

    var body: some View {
        let scoped = scopedPortfolios
        let scopeResult = calculateScope(for: scoped)
        let targetMap = targetPercentages(for: scope)
        let suggestions = rebalanceSuggestions(scope: scopeResult, targets: targetMap)

        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Picker(L10n.t("rebalance.portfolio"), selection: $scope) {
                    Text(L10n.t("common.all")).tag(RebalanceScope.all)

                    if !groups.isEmpty {
                        Divider()
                        ForEach(groups) { g in
                            Text("\(L10n.t("nav.groups")): \(g.name)").tag(RebalanceScope.group(g.id))
                        }
                    }

                    if !portfolios.isEmpty {
                        Divider()
                        ForEach(portfolios) { p in
                            Text(p.name).tag(RebalanceScope.portfolio(p.id))
                        }
                    }
                }
                .pickerStyle(.menu)
                .frame(maxWidth: 420)

                Text(scopeCaption(scoped))
                    .font(.caption)
                    .foregroundStyle(.secondary)

                GroupBox(L10n.t("rebalance.targets")) {
                    VStack(spacing: 8) {
                        ForEach(AssetTypeDefaults.supported, id: \.self) { key in
                            TargetRow(
                                assetType: key,
                                targetPct: Binding(
                                    get: { targetMap[key] ?? 0 },
                                    set: { setTargetPct($0, assetType: key) }
                                ),
                                actualPct: actualPct(for: key, scope: scopeResult)
                            )
                        }
                    }
                    .padding(.top, 6)
                }

                GroupBox(L10n.t("rebalance.suggestions")) {
                    if suggestions.isEmpty {
                        ContentUnavailableView(
                            L10n.t("rebalance.noSuggestions"),
                            systemImage: "arrow.left.arrow.right",
                            description: Text(L10n.t("dashboard.noDataHint"))
                        )
                        .frame(maxWidth: .infinity, minHeight: 180)
                    } else {
                        VStack(spacing: 10) {
                            ForEach(suggestions) { s in
                                HStack {
                                    Text(L10n.assetLabel(s.assetType))
                                    Text(s.deltaValue >= 0 ? L10n.t("rebalance.buy") : L10n.t("rebalance.reduce"))
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                    Spacer()
                                    VStack(alignment: .trailing, spacing: 2) {
                                        Text(LWFormatting.money(s.deltaValue, currency: scopeResult.baseCurrency))
                                            .foregroundStyle(s.deltaValue >= 0 ? .green : .red)
                                        Text("\(L10n.t("rebalance.actual")) \(String(format: "%.1f", s.actualPct))% → \(L10n.t("rebalance.target")) \(String(format: "%.0f", s.targetPct))%")
                                            .font(.caption2)
                                            .foregroundStyle(.secondary)
                                    }
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
        .navigationTitle(L10n.t("nav.rebalance"))
        .id(appState.localizationEpoch)
        .task {
            if let rates = try? await NBPExchangeRateService.ratesToPLN() {
                ratesToPLN = rates
            }
        }
        .onAppear { syncScopeFromAppState() }
        .onChange(of: scope) { _, newValue in
            applyScopeToAppState(newValue)
        }
    }

    private var scopedPortfolios: [Portfolio] {
        switch scope {
        case .all:
            return portfolios
        case .group(let gid):
            return portfolios.filter { $0.group?.id == gid }
        case .portfolio(let pid):
            return portfolios.filter { $0.id == pid }
        }
    }

    private func scopeCaption(_ scoped: [Portfolio]) -> String {
        switch scope {
        case .all:
            return L10n.language == .en
                ? "All portfolios (\(scoped.count)) — targets shared globally"
                : "Wszystkie portfele (\(scoped.count)) — wspólne cele globalne"
        case .group:
            return L10n.language == .en
                ? "Group aggregate (\(scoped.count) portfolios) — targets applied to each portfolio in the group"
                : "Agregat grupy (\(scoped.count) portfeli) — cele zapisywane w każdym portfelu grupy"
        case .portfolio:
            return scoped.first.map { p in
                L10n.language == .en ? "Portfolio: \(p.name)" : "Portfel: \(p.name)"
            } ?? ""
        }
    }

    private func calculateScope(for scoped: [Portfolio]) -> ScopeResult {
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

    private func actualPct(for assetType: String, scope: ScopeResult) -> Double {
        guard scope.totalValueBase > 0 else { return 0 }
        return ((scope.allocationByType[assetType] ?? 0) / scope.totalValueBase) * 100
    }

    private func targetPercentages(for scope: RebalanceScope) -> [String: Double] {
        switch scope {
        case .all:
            let list = targets.filter { $0.portfolio == nil }
            return Dictionary(uniqueKeysWithValues: list.map { ($0.assetType, $0.targetPct) })
        case .group(let gid):
            // Prefer targets from the first portfolio in the group (kept in sync on write).
            guard let first = portfolios.first(where: { $0.group?.id == gid }) else { return [:] }
            let list = targets.filter { $0.portfolio?.id == first.id }
            return Dictionary(uniqueKeysWithValues: list.map { ($0.assetType, $0.targetPct) })
        case .portfolio(let pid):
            let list = targets.filter { $0.portfolio?.id == pid }
            return Dictionary(uniqueKeysWithValues: list.map { ($0.assetType, $0.targetPct) })
        }
    }

    private func setTargetPct(_ pct: Double, assetType: String) {
        switch scope {
        case .all:
            upsertTarget(assetType: assetType, pct: pct, portfolio: nil)
        case .group(let gid):
            let members = portfolios.filter { $0.group?.id == gid }
            for portfolio in members {
                upsertTarget(assetType: assetType, pct: pct, portfolio: portfolio)
            }
        case .portfolio(let pid):
            guard let portfolio = portfolios.first(where: { $0.id == pid }) else { return }
            upsertTarget(assetType: assetType, pct: pct, portfolio: portfolio)
        }
        try? context.save()
    }

    private func upsertTarget(assetType: String, pct: Double, portfolio: Portfolio?) {
        if portfolio == nil {
            if let global = targets.first(where: { $0.assetType == assetType && $0.portfolio == nil }) {
                global.targetPct = pct
            } else {
                context.insert(AllocationTarget(assetType: assetType, targetPct: pct, createdAt: .now, portfolio: nil))
            }
            return
        }

        if let existing = targets.first(where: { $0.assetType == assetType && $0.portfolio?.id == portfolio!.id }) {
            existing.targetPct = pct
        } else {
            context.insert(AllocationTarget(assetType: assetType, targetPct: pct, createdAt: .now, portfolio: portfolio))
        }
    }

    private func rebalanceSuggestions(scope: ScopeResult, targets: [String: Double]) -> [RebalanceSuggestion] {
        guard scope.totalValueBase > 0 else { return [] }
        let total = scope.totalValueBase
        let current = scope.allocationByType

        var out: [RebalanceSuggestion] = []
        for key in AssetTypeDefaults.supported {
            let targetPct = targets[key] ?? 0
            if targetPct <= 0 { continue }
            let targetValue = (targetPct / 100.0) * total
            let currentValue = current[key] ?? 0
            let delta = targetValue - currentValue
            if abs(delta) < max(1.0, total * 0.002) { continue }
            let actualPct = (currentValue / total) * 100
            out.append(RebalanceSuggestion(assetType: key, deltaValue: delta, actualPct: actualPct, targetPct: targetPct))
        }
        return out.sorted { abs($0.deltaValue) > abs($1.deltaValue) }
    }

    private func syncScopeFromAppState() {
        if let pid = appState.selectedPortfolioId {
            scope = .portfolio(pid)
        } else if let gid = appState.selectedGroupId {
            scope = .group(gid)
        } else {
            scope = .all
        }
    }

    private func applyScopeToAppState(_ scope: RebalanceScope) {
        switch scope {
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
}

private struct TargetRow: View {
    let assetType: String
    @Binding var targetPct: Double
    let actualPct: Double

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(L10n.assetLabel(assetType))
                    .frame(width: 120, alignment: .leading)
                Slider(value: $targetPct, in: 0...100, step: 1)
                Text("\(Int(targetPct))%")
                    .frame(width: 44, alignment: .trailing)
                    .monospacedDigit()
            }
            Text("\(L10n.t("rebalance.actual")): \(String(format: "%.1f", actualPct))%")
                .font(.caption2)
                .foregroundStyle(.secondary)
                .padding(.leading, 120)
        }
    }
}

private struct RebalanceSuggestion: Identifiable {
    let id = UUID()
    let assetType: String
    let deltaValue: Double
    let actualPct: Double
    let targetPct: Double
}
