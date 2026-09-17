import type { AccentName } from './palette';

/**
 * The module registry. This is the single place a module is declared; the
 * carousel, the command engine, the ⌘K palette, the HUD and the embodied
 * panel presenter all read from here. Adding a module is one entry.
 */
export type ModuleId =
  | 'instagram'
  | 'stocks'
  | 'projects'
  | 'sports'
  | 'calendar'
  | 'weather'
  | 'ai'
  | 'news'
  | 'music'
  | 'system';

export interface ModuleDef {
  id: ModuleId;
  label: string;
  /** Shown under the title on the card face. */
  caption: string;
  accent: AccentName;
  /** Phrases the local command matcher accepts, beyond the label itself. */
  aliases: string[];
  /** Phase 4: the world this module morphs the environment into, if any. */
  world?: WorldId;
  /** Data endpoint under /api. Absent = purely local module. */
  endpoint?: string;
}

export const MODULES: readonly ModuleDef[] = [
  {
    id: 'instagram',
    label: 'Instagram',
    caption: 'Reach · Growth · Engagement',
    accent: 'violet',
    aliases: ['insta', 'ig', 'my reels', 'my profile', 'socials'],
    endpoint: '/api/instagram',
  },
  {
    id: 'stocks',
    label: 'Stocks',
    caption: 'Portfolio · Allocation · P/L',
    accent: 'cyan',
    aliases: ['portfolio', 'markets', 'market', 'shares', 'equities'],
    world: 'market-grid',
    endpoint: '/api/stocks',
  },
  {
    id: 'projects',
    label: 'Projects',
    caption: 'Worlds · Media · History',
    accent: 'indigo',
    aliases: ['work', 'my projects', 'builds', 'portfolio of work'],
    world: 'dark-lab',
    endpoint: '/api/projects',
  },
  {
    id: 'sports',
    label: 'Sports',
    caption: 'Live · Fixtures · Standings',
    accent: 'teal',
    aliases: ['scores', 'football', 'matches', 'fixtures'],
    endpoint: '/api/sports',
  },
  {
    id: 'calendar',
    label: 'Calendar',
    caption: 'Schedule · Today · Ahead',
    accent: 'blue',
    aliases: ['schedule', 'agenda', 'my day', "what's my schedule"],
    endpoint: '/api/calendar',
  },
  {
    id: 'weather',
    label: 'Weather',
    caption: 'Conditions · Forecast',
    accent: 'azure',
    aliases: ['forecast', 'temperature', 'outside'],
    world: 'weather-reactive',
    endpoint: '/api/weather',
  },
  {
    id: 'ai',
    label: 'AI',
    caption: 'Reasoning · Search · Code',
    accent: 'violet',
    aliases: ['assistant', 'nexus', 'brain', 'chat'],
    world: 'fog-chamber',
  },
  {
    id: 'news',
    label: 'News',
    caption: 'Summarised · Stacked',
    accent: 'indigo',
    aliases: ['headlines', 'briefing', 'what happened'],
    endpoint: '/api/news',
  },
  {
    id: 'music',
    label: 'Music',
    caption: 'Transport · Now Playing',
    accent: 'cyan',
    aliases: ['player', 'now playing', 'spotify', 'audio'],
    endpoint: '/api/music',
  },
  {
    id: 'system',
    label: 'System',
    caption: 'GPU · Memory · Network',
    accent: 'azure',
    aliases: ['diagnostics', 'stats', 'performance', 'machine'],
    world: 'industrial-deck',
    endpoint: '/api/system',
  },
] as const;

export const MODULE_BY_ID: Record<ModuleId, ModuleDef> = Object.fromEntries(
  MODULES.map((m) => [m.id, m]),
) as Record<ModuleId, ModuleDef>;

export type WorldId =
  | 'minimal-studio'
  | 'dark-lab'
  | 'glass-observatory'
  | 'industrial-deck'
  | 'open-water'
  | 'fog-chamber'
  | 'market-grid'
  | 'weather-reactive';
