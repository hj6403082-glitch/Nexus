import { readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface InstalledApp {
  /** The name macOS knows it by, without `.app`. */
  name: string;
  path: string;
  /** Lowercased name, for matching. */
  key: string;
}

const ROOTS = [
  '/Applications',
  '/Applications/Utilities',
  '/System/Applications',
  '/System/Applications/Utilities',
  join(homedir(), 'Applications'),
];

let cache: { at: number; apps: InstalledApp[] } | null = null;
const TTL = 60_000;

/**
 * APPLICATIONS RESOLVE AGAINST A LIVE SCAN.
 *
 * This is the second half of the injection defence, and it is the half that
 * matters for a VOICE interface. `execFile` guarantees a hostile string is
 * inert; this guarantees it does not even name a target. An app that is not
 * installed cannot be named, so the argument space is not "any string the
 * speech recogniser produced" — it is "one of the ~90 bundles on this disk".
 *
 * A directory listing, not a database: an app installed a minute ago works,
 * and an app deleted a minute ago stops working, with no cache to invalidate
 * beyond a minute.
 */
export async function scanApps(): Promise<InstalledApp[]> {
  if (cache && Date.now() - cache.at < TTL) return cache.apps;

  const found = new Map<string, InstalledApp>();
  for (const root of ROOTS) {
    let entries: string[];
    try {
      entries = await readdir(root);
    } catch {
      continue; // A root that does not exist on this machine is not an error.
    }
    for (const entry of entries) {
      if (!entry.endsWith('.app')) continue;
      const name = entry.slice(0, -4);
      const key = name.toLowerCase();
      if (!found.has(key)) found.set(key, { name, path: join(root, entry), key });
    }
  }

  const apps = [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
  cache = { at: Date.now(), apps };
  return apps;
}

/**
 * Resolve a spoken phrase to an installed application, or to nothing.
 *
 * Returning `null` is the safe and common outcome, and it is what an injected
 * command string resolves to.
 */
export async function resolveApp(spoken: string): Promise<InstalledApp | null> {
  const query = spoken.toLowerCase().trim().replace(/\.app$/, '');
  if (!query) return null;
  const apps = await scanApps();

  const exact = apps.find((a) => a.key === query);
  if (exact) return exact;

  const aliased = ALIASES[query];
  if (aliased) {
    const hit = apps.find((a) => a.key === aliased);
    if (hit) return hit;
  }

  const prefix = apps.find((a) => a.key.startsWith(query));
  if (prefix) return prefix;

  // Word-boundary match, so "code" finds "Visual Studio Code" but "de" does not.
  const boundary = apps.find((a) => a.key.split(/[\s\-_]+/).some((w) => w === query));
  if (boundary) return boundary;

  // Substring only when the query is long enough to be meaningful.
  if (query.length >= 4) {
    const sub = apps.find((a) => a.key.includes(query));
    if (sub) return sub;
  }
  return null;
}

/** Spoken names that are not the bundle name. */
const ALIASES: Record<string, string> = {
  chrome: 'google chrome',
  browser: 'safari',
  code: 'visual studio code',
  vscode: 'visual studio code',
  terminal: 'terminal',
  music: 'music',
  spotify: 'spotify',
  slack: 'slack',
  notes: 'notes',
  mail: 'mail',
  calendar: 'calendar',
  settings: 'system settings',
  preferences: 'system settings',
  finder: 'finder',
};
