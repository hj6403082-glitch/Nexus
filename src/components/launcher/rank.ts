export interface Rankable {
  id: string;
  label: string;
  source: 'module' | 'app' | 'site' | 'command';
  detail?: string;
}

/**
 * THE RANKING LADDER.
 *
 * Four tiers, tried in order, and an earlier tier always beats a later one no
 * matter how good the later match looks:
 *
 *   1. PREFIX      "saf" → Safari. What you type first is what you meant.
 *   2. INITIALS    "vsc" → Visual Studio Code. How people actually refer to
 *                  multi-word apps.
 *   3. WORD BOUNDARY  "code" → Visual Studio Code, but NOT → Xcode. A match
 *                  inside a word is not a match on the word.
 *   4. SUBSTRING   the last resort, and scored well below the rest so it never
 *                  outranks a real match.
 *
 * Score-summing across tiers is what produces palettes where typing the exact
 * name of a thing surfaces something else above it — so the tiers are ordinal,
 * not additive, and only the position within a tier is tuned.
 */
export function rank<T extends Rankable>(items: T[], query: string): T[] {
  const q = query.toLowerCase().trim();
  if (!q) return items.slice(0, 40);

  const scored: { item: T; tier: number; position: number }[] = [];

  for (const item of items) {
    const label = item.label.toLowerCase();
    const words = label.split(/[\s\-_/]+/).filter(Boolean);

    if (label.startsWith(q)) {
      scored.push({ item, tier: 0, position: label.length });
      continue;
    }

    const initials = words.map((w) => w[0]).join('');
    if (initials.startsWith(q) && q.length > 1) {
      scored.push({ item, tier: 1, position: label.length });
      continue;
    }

    const wordIndex = words.findIndex((w) => w.startsWith(q));
    if (wordIndex >= 0) {
      scored.push({ item, tier: 2, position: wordIndex * 100 + label.length });
      continue;
    }

    const at = label.indexOf(q);
    if (at >= 0) {
      scored.push({ item, tier: 3, position: at * 100 + label.length });
    }
  }

  scored.sort((a, b) => a.tier - b.tier || a.position - b.position);
  return scored.slice(0, 40).map((s) => s.item);
}
