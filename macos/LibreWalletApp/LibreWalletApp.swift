import SwiftUI
import SwiftData

@main
struct LibreWalletApp: App {
    @StateObject private var appState = AppState()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(appState)
        }
        .modelContainer(LWModelContainer.shared)
        .commands {
            SidebarCommands()
        }
    }
}

