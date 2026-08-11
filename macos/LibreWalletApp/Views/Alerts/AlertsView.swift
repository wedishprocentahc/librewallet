import SwiftUI
import SwiftData
import UserNotifications
import AppKit

private struct PositionSymbolOption: Identifiable, Hashable {
    var id: String { "\(symbol.uppercased())|\(currency.uppercased())" }
    let symbol: String
    let currency: String
    let name: String
}

struct AlertsView: View {
    @EnvironmentObject private var appState: AppState
    @Query(sort: \Quote.asOf, order: .reverse) private var quotes: [Quote]
    @Query(sort: \Transaction.date) private var transactions: [Transaction]
    @Query(sort: \AllocationTarget.createdAt) private var targets: [AllocationTarget]
    @Query(sort: \Portfolio.createdAt) private var portfolios: [Portfolio]
    @Query(sort: \PortfolioGroup.createdAt) private var groups: [PortfolioGroup]

    @State private var symbolScope: SavedAlertScope = .all
    @State private var pickedPositionId: String?
    @State private var symbol: String = ""
    @State private var currency: String = "PLN"
    @State private var target: String = ""
    @State private var above = true
    @State private var driftItems: [DriftAlertItem] = []
    @State private var ratesToPLN: [String: Double] = NBPExchangeRateService.cachedRatesToPLN()
    @State private var notificationStatus: UNAuthorizationStatus = .notDetermined

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                notificationsBanner
                driftSection
                Divider()
                priceSection
            }
            .padding()
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .navigationTitle(L10n.t("alerts.title"))
        .id(appState.localizationEpoch)
        .onAppear {
            if case .all = appState.alertDriftScope {
                // Prefer sidebar selection on first open if scope still default-all and sidebar has a pick.
                syncDriftScopeFromSidebarIfNeeded()
            }
            symbolScope = appState.alertDriftScope
            Task { await evaluateNow() }
            Task { await refreshNotificationStatus() }
        }
        .onChange(of: appState.alertDriftScope) { _, _ in
            Task { await evaluateDrift() }
        }
        .onChange(of: appState.allocationDriftPct) { _, _ in
            Task { await evaluateDrift() }
        }
        .task {
            if let rates = try? await NBPExchangeRateService.ratesToPLN() {
                ratesToPLN = rates
                await evaluateDrift()
            }
        }
    }

    // MARK: - Notifications banner

    private var notificationsBanner: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(L10n.t("alerts.notifications"))
                .font(.headline)
            Text(L10n.t("alerts.liveHint"))
                .font(.caption)
                .foregroundStyle(.secondary)
            Text(notificationStatusText)
                .font(.caption)
                .foregroundStyle(
                    (notificationStatus == .authorized || notificationStatus == .provisional)
                    ? AnyShapeStyle(.secondary)
                    : AnyShapeStyle(Color.orange)
                )
            HStack {
                if notificationStatus != .authorized && notificationStatus != .provisional {
                    Button(L10n.t("alerts.notifications.enable")) {
                        Task {
                            _ = await PriceAlertService.requestAuthorization()
                            await refreshNotificationStatus()
                            if notificationStatus == .denied {
                                if let url = URL(string: "x-apple.systempreferences:com.apple.Notifications-Settings.extension") {
                                    NSWorkspace.shared.open(url)
                                }
                            }
                        }
                    }
                }
                Button(L10n.t("alerts.notifications.test")) {
                    Task {
                        _ = await PriceAlertService.requestAuthorization()
                        await PriceAlertService.sendTestNotification()
                        await refreshNotificationStatus()
                    }
                }
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.quaternary.opacity(0.5), in: RoundedRectangle(cornerRadius: 8))
    }

    private var notificationStatusText: String {
        switch notificationStatus {
        case .authorized, .provisional, .ephemeral:
            return L10n.t("alerts.notifications.status.authorized")
        case .denied:
            return L10n.t("alerts.notifications.status.denied")
        case .notDetermined:
            return L10n.t("alerts.notifications.status.notDetermined")
        @unknown default:
            return L10n.t("alerts.notifications.status.notDetermined")
        }
    }

    // MARK: - Drift

    private var driftSection: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(L10n.t("alerts.driftHeader"))
                .font(.title2.weight(.semibold))

            VStack(alignment: .leading, spacing: 16) {
                VStack(alignment: .leading, spacing: 6) {
                    Text(L10n.t("alerts.scope"))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    scopePicker(
                        selection: Binding(
                            get: { appState.alertDriftScope },
                            set: { appState.alertDriftScope = $0 }
                        ),
                        label: L10n.t("alerts.scope")
                    )
                    .labelsHidden()
                    Text(scopeCaption(for: appState.alertDriftScope))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                VStack(alignment: .leading, spacing: 6) {
                    HStack {
                        Text(L10n.t("alerts.drift"))
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        Spacer()
                        Text("\(Int(appState.allocationDriftPct))%")
                            .font(.body.monospacedDigit().weight(.semibold))
                    }
                    Slider(value: Binding(
                        get: { appState.allocationDriftPct },
                        set: { appState.allocationDriftPct = $0 }
                    ), in: 0...25, step: 1)
                }

                Divider()

                driftStatusBlock

                HStack {
                    Spacer()
                    Button(L10n.t("alerts.checkNow")) {
                        Task { await evaluateNow() }
                    }
                }
            }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(.quaternary.opacity(0.45), in: RoundedRectangle(cornerRadius: 10))
        }
    }

    @ViewBuilder
    private var driftStatusBlock: some View {
        if driftItems.isEmpty {
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: "checkmark.circle.fill")
                    .foregroundStyle(.green)
                    .font(.title3)
                VStack(alignment: .leading, spacing: 2) {
                    Text(L10n.t("alerts.driftStatus.ok"))
                        .font(.body.weight(.medium))
                    Text(L10n.t("alerts.noDrift"))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        } else {
            VStack(alignment: .leading, spacing: 10) {
                HStack(spacing: 8) {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .foregroundStyle(.orange)
                    Text(L10n.t("alerts.driftStatus.alert", ["count": "\(driftItems.count)"]))
                        .font(.body.weight(.medium))
                }
                ForEach(driftItems) { item in
                    HStack {
                        Text(L10n.assetLabel(item.assetType))
                            .fontWeight(.medium)
                        Spacer()
                        Text(String(format: "%.1f%%", item.actualPct))
                            .monospacedDigit()
                        Text("→")
                            .foregroundStyle(.secondary)
                        Text(String(format: "%.0f%%", item.targetPct))
                            .monospacedDigit()
                            .foregroundStyle(.secondary)
                        Text(String(format: "Δ%.1f%%", item.driftPct))
                            .font(.callout.monospacedDigit().weight(.semibold))
                            .foregroundStyle(.orange)
                            .frame(minWidth: 64, alignment: .trailing)
                    }
                    .padding(.vertical, 4)
                    .padding(.horizontal, 10)
                    .background(.orange.opacity(0.12), in: RoundedRectangle(cornerRadius: 6))
                }
            }
        }
    }

    // MARK: - Price

    private var priceSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(L10n.t("alerts.priceHeader"))
                .font(.title2.weight(.semibold))

            Form {
                Section(L10n.t("alerts.priceNew")) {
                    scopePicker(selection: $symbolScope, label: L10n.t("alerts.symbolPortfolio"))
                        .onChange(of: symbolScope) { _, _ in
                            pickedPositionId = nil
                        }

                    if !positionSymbolOptions.isEmpty {
                        Picker(L10n.t("alerts.fromPositions"), selection: $pickedPositionId) {
                            Text(L10n.t("alerts.customSymbol")).tag(Optional<String>.none)
                            ForEach(positionSymbolOptions) { opt in
                                Text(positionLabel(opt)).tag(Optional(opt.id))
                            }
                        }
                        .onChange(of: pickedPositionId) { _, newId in
                            guard let newId,
                                  let opt = positionSymbolOptions.first(where: { $0.id == newId }) else { return }
                            symbol = opt.symbol
                            currency = opt.currency
                        }
                    }

                    TextField(L10n.t("alerts.symbol"), text: $symbol)
                        .onChange(of: symbol) { _, _ in
                            if let id = pickedPositionId,
                               let opt = positionSymbolOptions.first(where: { $0.id == id }),
                               symbol.trimmingCharacters(in: .whitespacesAndNewlines).uppercased() != opt.symbol.uppercased() {
                                pickedPositionId = nil
                            }
                        }
                    TextField(L10n.t("alerts.currency"), text: $currency)
                    TextField(L10n.t("alerts.targetPrice"), text: $target)
                    Toggle(L10n.t("alerts.whenAbove"), isOn: $above)
                    Button(L10n.t("common.add")) { addAlert() }
                        .disabled(
                            symbol.trimmingCharacters(in: .whitespaces).isEmpty
                                || Double(target.replacingOccurrences(of: ",", with: ".")) == nil
                        )
                }

                Section(L10n.t("alerts.priceList")) {
                    if appState.priceAlerts.isEmpty {
                        Text(L10n.t("alerts.empty")).foregroundStyle(.secondary)
                    } else {
                        ForEach(appState.priceAlerts) { alert in
                            HStack {
                                VStack(alignment: .leading) {
                                    Text("\(alert.symbol) \(alert.above ? "≥" : "≤") \(LWFormatting.number(alert.targetPrice)) \(alert.currency)")
                                    if let last = alert.lastTriggeredAt {
                                        Text("\(L10n.t("alerts.lastTriggered")): \(last.formatted())")
                                            .font(.caption2)
                                            .foregroundStyle(.secondary)
                                    }
                                }
                                Spacer()
                                Toggle("", isOn: Binding(
                                    get: { alert.enabled },
                                    set: { enabled in
                                        if let i = appState.priceAlerts.firstIndex(where: { $0.id == alert.id }) {
                                            appState.priceAlerts[i].enabled = enabled
                                        }
                                    }
                                ))
                                .labelsHidden()
                                Button(role: .destructive) {
                                    appState.priceAlerts.removeAll { $0.id == alert.id }
                                } label: {
                                    Image(systemName: "trash")
                                }
                                .buttonStyle(.borderless)
                            }
                        }
                    }
                }
            }
            .padding(.top, 2)
        }
    }

    // MARK: - Shared UI

    private func scopePicker(selection: Binding<SavedAlertScope>, label: String) -> some View {
        Picker(label, selection: selection) {
            Text(L10n.t("common.all")).tag(SavedAlertScope.all)

            if !groups.isEmpty {
                Divider()
                ForEach(groups) { g in
                    Text("\(L10n.t("nav.groups")): \(g.name)").tag(SavedAlertScope.group(g.id))
                }
            }

            if !portfolios.isEmpty {
                Divider()
                ForEach(portfolios) { p in
                    Text(p.name).tag(SavedAlertScope.portfolio(p.id))
                }
            }
        }
        .pickerStyle(.menu)
    }

    private func positionLabel(_ opt: PositionSymbolOption) -> String {
        if opt.name.isEmpty || opt.name.uppercased() == opt.symbol.uppercased() {
            return "\(opt.symbol) · \(opt.currency)"
        }
        return "\(opt.symbol) · \(opt.currency) — \(opt.name)"
    }

    // MARK: - Data

    private var positionSymbolOptions: [PositionSymbolOption] {
        let scoped = scopedPortfolios(for: symbolScope)
        let result: ScopeResult
        if scoped.count == 1, let portfolio = scoped.first {
            result = PortfolioCalculator.calculate(
                portfolio: portfolio,
                allTransactions: transactions,
                quotes: quotes,
                ratesToPLN: ratesToPLN
            )
        } else {
            result = PortfolioCalculator.aggregateToPLN(
                portfolios: scoped,
                allTransactions: transactions,
                quotes: quotes,
                ratesToPLN: ratesToPLN
            )
        }

        var byId: [String: PositionSymbolOption] = [:]
        for p in result.positions where p.quantity > 0 {
            let opt = PositionSymbolOption(symbol: p.symbol, currency: p.currency, name: p.name)
            byId[opt.id] = opt
        }
        return byId.values.sorted {
            $0.symbol.localizedCaseInsensitiveCompare($1.symbol) == .orderedAscending
        }
    }

    private func scopedPortfolios(for scope: SavedAlertScope) -> [Portfolio] {
        switch scope {
        case .all:
            return Array(portfolios)
        case .group(let gid):
            return portfolios.filter { $0.group?.id == gid }
        case .portfolio(let pid):
            return portfolios.filter { $0.id == pid }
        }
    }

    private func scopeCaption(for scope: SavedAlertScope) -> String {
        let scoped = scopedPortfolios(for: scope)
        switch scope {
        case .all:
            return L10n.language == .en
                ? "All portfolios (\(scoped.count)) — global targets"
                : "Wszystkie portfele (\(scoped.count)) — cele globalne"
        case .group:
            return L10n.language == .en
                ? "Group aggregate (\(scoped.count) portfolios)"
                : "Agregat grupy (\(scoped.count) portfeli)"
        case .portfolio:
            return scoped.first.map { p in
                L10n.language == .en ? "Portfolio: \(p.name)" : "Portfel: \(p.name)"
            } ?? ""
        }
    }

    private func targetPercentages(for scope: SavedAlertScope) -> [String: Double] {
        switch scope {
        case .all:
            let list = targets.filter { $0.portfolio == nil }
            return Dictionary(uniqueKeysWithValues: list.map { ($0.assetType, $0.targetPct) })
        case .group(let gid):
            guard let first = portfolios.first(where: { $0.group?.id == gid }) else { return [:] }
            let list = targets.filter { $0.portfolio?.id == first.id }
            return Dictionary(uniqueKeysWithValues: list.map { ($0.assetType, $0.targetPct) })
        case .portfolio(let pid):
            let list = targets.filter { $0.portfolio?.id == pid }
            return Dictionary(uniqueKeysWithValues: list.map { ($0.assetType, $0.targetPct) })
        }
    }

    private func calculateScope(for scope: SavedAlertScope) -> ScopeResult {
        let scoped = scopedPortfolios(for: scope)
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

    private func syncDriftScopeFromSidebarIfNeeded() {
        if let pid = appState.selectedPortfolioId {
            appState.alertDriftScope = .portfolio(pid)
        } else if let gid = appState.selectedGroupId {
            appState.alertDriftScope = .group(gid)
        }
    }

    private func addAlert() {
        guard let price = Double(target.replacingOccurrences(of: ",", with: ".")) else { return }
        let alert = PriceAlert(
            symbol: symbol.trimmingCharacters(in: .whitespacesAndNewlines),
            currency: currency.trimmingCharacters(in: .whitespacesAndNewlines).uppercased(),
            targetPrice: price,
            above: above
        )
        appState.priceAlerts.append(alert)
        symbol = ""
        target = ""
        pickedPositionId = nil
    }

    private func evaluateNow() async {
        var alerts = appState.priceAlerts
        // Manual check bypasses daily cooldown so you can verify notifications.
        let hit = PriceAlertService.evaluate(quotes: quotes, alerts: alerts, force: true)
        await PriceAlertService.notifyPrice(hit, updating: &alerts)
        appState.priceAlerts = alerts
        await evaluateDrift(notify: true, force: true)
    }

    private func evaluateDrift(notify: Bool = false, force: Bool = false) async {
        let scopeResult = calculateScope(for: appState.alertDriftScope)
        let targetMap = targetPercentages(for: appState.alertDriftScope)
        let items = PriceAlertService.allocationDriftItems(
            scope: scopeResult,
            targets: targetMap,
            thresholdPct: appState.allocationDriftPct
        )
        driftItems = items
        if notify {
            await PriceAlertService.notifyDrift(items, force: force)
        }
    }

    private func refreshNotificationStatus() async {
        notificationStatus = await PriceAlertService.authorizationStatus()
    }
}
