/** Return whether an incoming positive snapshot sequence is newer. */
export function isNewerSnapshotSequence(incoming: number, previous: number): boolean {
  if (!Number.isFinite(incoming) || incoming <= 0) return true;
  return incoming > previous;
}

/** Reject snapshots that belong to a different zone during scene transitions. */
export function isSnapshotForZone(snapshotZone: string | undefined, expectedZone: string | null): boolean {
  if (expectedZone === null) return true;
  return snapshotZone === expectedZone;
}
