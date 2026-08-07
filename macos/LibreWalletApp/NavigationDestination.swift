import Foundation
import SwiftData

enum NavigationDestination: Hashable {
    case dashboard
    case positions
    case transactions
    case imports
    case rebalance
    case bonds
    case settings
    case group(UUID)
    case portfolio(UUID)
}
