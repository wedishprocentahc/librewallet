import Foundation

/// Skips broker rows that were already imported (same `externalId`, or same content fingerprint).
enum ImportDeduper {
    struct Outcome: Equatable {
        let toInsert: [ImportedTransaction]
        let skippedDuplicates: Int
    }

    /// Content key that survives re-exports where the broker assigns different IDs / sub-second
    /// timestamps to the same operation (e.g. XTB closes: `n` vs `n+1`, `12:00:05` vs `12:00:05.873`).
    static func fingerprint(
        type: String,
        symbol: String?,
        date: Date,
        quantity: Double?,
        cashDelta: Double?,
        currency: String
    ) -> String {
        let seconds = Int64(date.timeIntervalSince1970.rounded(.down))
        let qty = String(format: "%.4f", quantity ?? 0)
        let cash = String(format: "%.2f", cashDelta ?? 0)
        return [type, (symbol ?? "").uppercased(), String(seconds), qty, cash, currency.uppercased()]
            .joined(separator: "|")
    }

    static func fingerprint(_ item: ImportedTransaction) -> String {
        fingerprint(
            type: item.type.rawValue,
            symbol: item.symbol,
            date: item.date,
            quantity: item.quantity,
            cashDelta: item.cashDelta,
            currency: item.currency
        )
    }

    /// Filters `items` against IDs already in the store and against duplicates within the batch.
    /// Rows whose content fingerprint matches a stored row are skipped even if the ID differs.
    /// Rows without an `externalId` are kept unless they match a stored fingerprint.
    static func filterNew(
        _ items: [ImportedTransaction],
        existingExternalIds: Set<String>,
        existingFingerprints: Set<String> = []
    ) -> Outcome {
        var seen = Set(existingExternalIds.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty })
        var toInsert: [ImportedTransaction] = []
        var skipped = 0

        for item in items {
            if existingFingerprints.contains(fingerprint(item)) {
                skipped += 1
                continue
            }
            let raw = item.externalId?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            guard !raw.isEmpty else {
                toInsert.append(item)
                continue
            }
            if seen.contains(raw) {
                skipped += 1
                continue
            }
            seen.insert(raw)
            toInsert.append(item)
        }

        return Outcome(toInsert: toInsert, skippedDuplicates: skipped)
    }
}
