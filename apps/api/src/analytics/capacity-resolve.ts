/** Resolve group-class capacity when session.externalId ≠ Forma schedule id. */

export type CapacitySlotHint = {
  externalId: string;
  capacity: number | null;
  startAt: Date;
  title: string;
};

export type CapacitySessionHint = {
  externalId: string;
  capacity?: number | null;
  startAt: Date;
  title: string;
};

function startTitleKey(startAt: Date, title: string): string {
  return `${startAt.getTime()}|${title}`;
}

/** Prefer exact slot → same start+title → most common capacity for title. */
export function buildCapacityResolver(slots: CapacitySlotHint[]) {
  const byExternal = new Map<string, number>();
  const byStartTitle = new Map<string, number>();
  const titleCounts = new Map<string, Map<number, number>>();

  for (const s of slots) {
    const cap = s.capacity ?? 0;
    if (cap <= 0) continue;
    byExternal.set(s.externalId, cap);
    byStartTitle.set(startTitleKey(s.startAt, s.title), cap);
    let counts = titleCounts.get(s.title);
    if (!counts) {
      counts = new Map();
      titleCounts.set(s.title, counts);
    }
    counts.set(cap, (counts.get(cap) ?? 0) + 1);
  }

  const byTitle = new Map<string, number>();
  for (const [title, counts] of titleCounts) {
    let bestCap = 0;
    let bestN = 0;
    for (const [cap, n] of counts) {
      if (n > bestN || (n === bestN && cap > bestCap)) {
        bestCap = cap;
        bestN = n;
      }
    }
    if (bestCap > 0) byTitle.set(title, bestCap);
  }

  return (session: CapacitySessionHint): number => {
    if (session.capacity && session.capacity > 0) return session.capacity;
    return (
      byExternal.get(session.externalId) ??
      byStartTitle.get(startTitleKey(session.startAt, session.title)) ??
      byTitle.get(session.title) ??
      0
    );
  };
}
