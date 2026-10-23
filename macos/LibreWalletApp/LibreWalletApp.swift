import SwiftUI
import SwiftData

@main
struct LibreWalletApp: App {
    @StateObject private var appState = AppState()
    @StateObject private var updateController = UpdateController()

    init() {
        PriceAlertService.configure()
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(appState)
                .environmentObject(updateController)
                .task {
                    LocalIntegrationServer.shared.start(container: LWModelContainer.shared)
                    SyncCoordinator.shared.onDataMerged = { AgentFeedPublisher.publishNow() }
                    SyncCoordinator.shared.start(container: LWModelContainer.shared)
                    AgentFeedPublisher.configure(container: LWModelContainer.shared)
                    _ = try? await NBPExchangeRateService.ratesToPLN()
                    AgentFeedPublisher.publishNow()
                }
        }
        .modelContainer(LWModelContainer.shared)
        .commands {
            SidebarCommands()
            CommandGroup(replacing: .appInfo) {
                Button("O LibreWallet") {
                    updateController.showAbout = true
                }
            }
            CommandGroup(after: .appInfo) {
                Button("Sprawdź aktualizacje…") {
                    Task { await updateController.checkForUpdates(interactive: true) }
                }
                .disabled(updateController.isChecking)
            }
        }
    }
}

