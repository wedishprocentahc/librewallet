import Foundation

@MainActor
final class AppState: ObservableObject {
    @Published var selectedPortfolioId: UUID?
    @Published var selectedGroupId: UUID?
    @Published var navigationSelection: NavigationDestination? = .dashboard

    func selectPortfolio(_ portfolio: Portfolio) {
        selectedPortfolioId = portfolio.id
        selectedGroupId = portfolio.group?.id
    }
}

