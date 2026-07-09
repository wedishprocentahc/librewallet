import Foundation

struct BondPreset: Identifiable, Hashable {
    var id: String { code }
    let code: String
    let name: String
    let termMonths: Int
    let firstYearRate: Double
    let margin: Double
    let indexation: String
    let capitalization: Bool
    let earlyRedemptionFee: Double
}

enum BondPresets {
    static let all: [BondPreset] = [
        BondPreset(code: "OTS", name: "OTS – 3-miesięczne stałoprocentowe", termMonths: 3, firstYearRate: 3.0, margin: 0, indexation: "fixed", capitalization: true, earlyRedemptionFee: 0),
        BondPreset(code: "ROR", name: "ROR – roczne zmienne (stopa ref. NBP)", termMonths: 12, firstYearRate: 5.75, margin: 0, indexation: "nbp", capitalization: false, earlyRedemptionFee: 0.5),
        BondPreset(code: "DOR", name: "DOR – 2-letnie zmienne (ref. NBP + marża)", termMonths: 24, firstYearRate: 5.9, margin: 0.5, indexation: "nbp", capitalization: false, earlyRedemptionFee: 0.7),
        BondPreset(code: "TOS", name: "TOS – 3-letnie stałoprocentowe", termMonths: 36, firstYearRate: 5.95, margin: 0, indexation: "fixed", capitalization: true, earlyRedemptionFee: 1.0),
        BondPreset(code: "COI", name: "COI – 4-letnie indeksowane inflacją", termMonths: 48, firstYearRate: 6.05, margin: 1.5, indexation: "cpi", capitalization: false, earlyRedemptionFee: 0.7),
        BondPreset(code: "EDO", name: "EDO – 10-letnie indeksowane inflacją", termMonths: 120, firstYearRate: 6.3, margin: 2.0, indexation: "cpi", capitalization: true, earlyRedemptionFee: 2.0),
        BondPreset(code: "ROS", name: "ROS – 6-letnie rodzinne (inflacja)", termMonths: 72, firstYearRate: 6.2, margin: 2.0, indexation: "cpi", capitalization: true, earlyRedemptionFee: 0.7),
        BondPreset(code: "ROD", name: "ROD – 12-letnie rodzinne (inflacja)", termMonths: 144, firstYearRate: 6.5, margin: 2.5, indexation: "cpi", capitalization: true, earlyRedemptionFee: 2.0),
    ]
}

