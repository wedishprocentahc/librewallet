import Foundation
import SwiftUI

@MainActor
final class UpdateController: ObservableObject {
    @Published var isChecking = false
    @Published var showAbout = false
    @Published var alertTitle = ""
    @Published var alertMessage = ""
    @Published var showAlert = false
    @Published var alertPrimaryURL: URL?
    @Published var alertPrimaryLabel: String?

    func checkForUpdates(interactive: Bool) async {
        guard !isChecking else { return }
        isChecking = true
        defer { isChecking = false }

        let result = await UpdateChecker.checkForUpdates()
        switch result {
        case .upToDate(let current):
            guard interactive else { return }
            present(
                title: "Brak aktualizacji",
                message: "Masz najnowszą wersję (\(current)).",
                url: nil,
                urlLabel: nil
            )
        case .updateAvailable(let latest, let releaseURL, let downloadURL):
            present(
                title: "Dostępna nowa wersja",
                message: "Zainstalowana: \(AppVersion.shortVersion)\nNowa: \(latest)\n\nPobierz ZIP ze strony lub z GitHub Releases, potem podmień LibreWallet.app (Applications).",
                url: downloadURL ?? releaseURL,
                urlLabel: "Pobierz aktualizację"
            )
        case .failed(let message):
            guard interactive else { return }
            present(
                title: "Nie udało się sprawdzić",
                message: message,
                url: LibreWalletDistribution.downloadPageURL,
                urlLabel: "Otwórz stronę pobierania"
            )
        }
    }

    private func present(title: String, message: String, url: URL?, urlLabel: String?) {
        alertTitle = title
        alertMessage = message
        alertPrimaryURL = url
        alertPrimaryLabel = urlLabel
        showAlert = true
    }
}
