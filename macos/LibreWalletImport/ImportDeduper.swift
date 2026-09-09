import Foundation

/// Skips broker rows that were already imported (same `externalId`).
enum ImportDeduper {
    struct Outcome: Equatable {
        let toInsert: [ImportedTransaction]
        let skippedDuplicates: Int
    }

    /// Filters `items` against IDs already in the store and against duplicates within the batch.
    /// Rows without an `externalId` are always kept (manual / incomplete broker exports).
    static func filterNew(
        _ items: [ImportedTransaction],
        existingExternalIds: Set<String>
    ) -> Outcome {
        var seen = Set(existingExternalIds.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty })
        var toInsert: [ImportedTransaction] = []
        var skipped = 0

        for item in items {
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
