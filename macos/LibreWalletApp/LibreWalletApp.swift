import SwiftUI
import SwiftData

@main
struct LibreWalletApp: App {
    @StateObject private var appState = AppState()
    @StateObject private var updateController = UpdateController()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(appState)
                .environmentObject(updateController)
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

