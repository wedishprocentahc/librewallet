import Foundation
import UserNotifications

struct DriftAlertItem: Identifiable, Hashable {
    var id: String { assetType }
    let assetType: String
    let actualPct: Double
    let targetPct: Double
    let driftPct: Double

    var message: String {
        "\(L10n.assetLabel(assetType)): \(String(format: "%.1f", actualPct))% vs \(String(format: "%.0f", targetPct))% (Δ\(String(format: "%.1f", driftPct))%)"
    }
}

enum PriceAlertService {
    private static let driftNotifiedKey = "lw.driftNotifiedDay"
    private static let driftNotifiedAssetsKey = "lw.driftNotifiedAssets"

    static let notificationDelegate = LWNotificationDelegate()

    static func configure() {
        UNUserNotificationCenter.current().delegate = notificationDelegate
    }

    static func requestAuthorization() async -> Bool {
        do {
            return try await UNUserNotificationCenter.current()
                .requestAuthorization(options: [.alert, .sound, .badge])
        } catch {
            return false
        }
    }

    static func authorizationStatus() async -> UNAuthorizationStatus {
        await UNUserNotificationCenter.current().notificationSettings().authorizationStatus
    }

    static func isAuthorized() async -> Bool {
        let status = await authorizationStatus()
        switch status {
        case .authorized, .provisional, .ephemeral:
            return true
        default:
            return false
        }
    }

    /// Alerts that currently breach their threshold (ignores daily cooldown).
    static func matching(quotes: [Quote], alerts: [PriceAlert]) -> [PriceAlert] {
        let bySymbol = Dictionary(grouping: quotes, by: { $0.symbol.uppercased() })
        var matched: [PriceAlert] = []
        for alert in alerts {
            guard alert.enabled else { continue }
            let sym = alert.symbol.uppercased()
            guard let quote = bySymbol[sym]?.first(where: { $0.currency.uppercased() == alert.currency })
                    ?? bySymbol[sym]?.first else { continue }
            let hit = alert.above ? quote.price >= alert.targetPrice : quote.price <= alert.targetPrice
            if hit { matched.append(alert) }
        }
        return matched
    }

    /// Returns alerts that should notify (once per day unless `force`). Does not mutate cooldown.
    static func evaluate(quotes: [Quote], alerts: [PriceAlert], force: Bool = false) -> [PriceAlert] {
        matching(quotes: quotes, alerts: alerts).filter { alert in
            if force { return true }
            if let last = alert.lastTriggeredAt, Calendar.current.isDateInToday(last) {
                return false
            }
            return true
        }
    }

    static func notifyPrice(_ alerts: [PriceAlert], updating stored: inout [PriceAlert]) async {
        guard !alerts.isEmpty else { return }
        guard await isAuthorized() else { return }

        for alert in alerts {
            let dir = alert.above ? "≥" : "≤"
            let ok = await post(
                id: "lw-price-\(alert.id.uuidString)-\(UUID().uuidString)",
                title: L10n.t("alerts.notify.priceTitle"),
                body: "\(alert.symbol) \(dir) \(LWFormatting.number(alert.targetPrice)) \(alert.currency)"
            )
            if ok, let i = stored.firstIndex(where: { $0.id == alert.id }) {
                stored[i].lastTriggeredAt = Date()
            }
        }
    }

    static func allocationDriftAlerts(
        scope: ScopeResult,
        targets: [String: Double],
        thresholdPct: Double
    ) -> [String] {
        allocationDriftItems(scope: scope, targets: targets, thresholdPct: thresholdPct).map(\.message)
    }

    static func allocationDriftItems(
        scope: ScopeResult,
        targets: [String: Double],
        thresholdPct: Double
    ) -> [DriftAlertItem] {
        guard thresholdPct > 0, scope.totalValueBase > 0 else { return [] }
        var items: [DriftAlertItem] = []
        for (key, targetPct) in targets where targetPct > 0 {
            let actualPct = ((scope.allocationByType[key] ?? 0) / scope.totalValueBase) * 100
            let drift = abs(actualPct - targetPct)
            if drift >= thresholdPct {
                items.append(DriftAlertItem(
                    assetType: key,
                    actualPct: actualPct,
                    targetPct: targetPct,
                    driftPct: drift
                ))
            }
        }
        return items.sorted { $0.assetType < $1.assetType }
    }

    static func notifyDrift(_ items: [DriftAlertItem], force: Bool = false) async {
        let fresh = force ? items : items.filter { !wasDriftNotifiedToday(assetType: $0.assetType) }
        guard !fresh.isEmpty else { return }
        guard await isAuthorized() else { return }

        for item in fresh {
            let ok = await post(
                id: "lw-drift-\(item.assetType)-\(UUID().uuidString)",
                title: L10n.t("alerts.notify.driftTitle"),
                body: item.message
            )
            if ok {
                markDriftNotified(assetType: item.assetType)
            }
        }
    }

    static func resetDriftCooldown() {
        UserDefaults.standard.removeObject(forKey: driftNotifiedKey)
        UserDefaults.standard.removeObject(forKey: driftNotifiedAssetsKey)
    }

    static func sendTestNotification() async {
        if !(await isAuthorized()) {
            guard await requestAuthorization() else { return }
        }
        _ = await post(
            id: "lw-test-\(UUID().uuidString)",
            title: "LibreWallet",
            body: L10n.t("alerts.notify.testBody")
        )
    }

    // MARK: - Private

    private static func dayKey(_ date: Date = Date()) -> String {
        let c = Calendar.current
        let y = c.component(.year, from: date)
        let m = c.component(.month, from: date)
        let d = c.component(.day, from: date)
        return String(format: "%04d-%02d-%02d", y, m, d)
    }

    private static func wasDriftNotifiedToday(assetType: String) -> Bool {
        let defaults = UserDefaults.standard
        guard defaults.string(forKey: driftNotifiedKey) == dayKey() else { return false }
        let assets = defaults.stringArray(forKey: driftNotifiedAssetsKey) ?? []
        return assets.contains(assetType)
    }

    private static func markDriftNotified(assetType: String) {
        let defaults = UserDefaults.standard
        let today = dayKey()
        if defaults.string(forKey: driftNotifiedKey) != today {
            defaults.set(today, forKey: driftNotifiedKey)
            defaults.set([assetType], forKey: driftNotifiedAssetsKey)
        } else {
            var assets = defaults.stringArray(forKey: driftNotifiedAssetsKey) ?? []
            if !assets.contains(assetType) {
                assets.append(assetType)
                defaults.set(assets, forKey: driftNotifiedAssetsKey)
            }
        }
    }

    private static func post(id: String, title: String, body: String) async -> Bool {
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        content.sound = .default
        let trigger = UNTimeIntervalNotificationTrigger(timeInterval: 0.3, repeats: false)
        let req = UNNotificationRequest(identifier: id, content: content, trigger: trigger)
        do {
            try await UNUserNotificationCenter.current().add(req)
            return true
        } catch {
            return false
        }
    }
}

final class LWNotificationDelegate: NSObject, UNUserNotificationCenterDelegate {
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification
    ) async -> UNNotificationPresentationOptions {
        [.banner, .list, .sound]
    }
}
