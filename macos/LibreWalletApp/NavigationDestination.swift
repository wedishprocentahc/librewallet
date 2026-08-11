import Foundation
import SwiftData

enum NavigationDestination: Hashable {
    case dashboard
    case positions
    case transactions
    case imports
    case rebalance
    case bonds
    case cashflow
    case tax
    case alerts
    case settings
    case group(UUID)
    case portfolio(UUID)
}
