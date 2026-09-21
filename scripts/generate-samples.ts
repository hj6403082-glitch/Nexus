/**
 * Freeze the sample module payloads into JSON at build time.
 *
 * The static build has no server, so `/api/*` does not exist — but the card
 * faces are the whole point of looking at NEXUS, and a ring of cards reading
 * "unreachable" shows nothing. Rather than maintaining a second copy of the
 * sample data by hand (which would drift from the adapters the moment either
 * changed), this RUNS the real adapters with no API keys — which is exactly
 * the path that produces their sample output — and writes what they return.
 *
 * One source of truth, shaped by the code that serves it in production.
 */
import { writeFile, mkdir } from 'node:fs/promises';
import {
  calendar,
  music,
  news,
  projects,
  sports,
  stocks,
  system,
  weather,
} from '../src/server/data/adapters.ts';
import { fetchInstagram } from '../src/server/data/instagram.ts';
import { compact, freshness } from '../src/server/data/adapters.ts';

const instagram = async () => {
  const snapshot = await fetchInstagram();
  const series = snapshot.followerSeries;
  const growth =
    series.length > 1 ? ((series[series.length - 1] - series[0]) / Math.max(series[0], 1)) * 100 : 0;
  return {
    provenance: snapshot.provenance,
    detail: snapshot,
    face: {
      title: 'Instagram',
      caption: 'Reach · Growth · Engagement',
      metric: compact(snapshot.followers),
      metricLabel: 'followers',
      series,
      rows: [
        ['reach (30d)', compact(snapshot.reach)],
        ['engagement', `${(snapshot.engagement * 100).toFixed(1)}%`],
        ['reels', String(snapshot.reels)],
        ['growth (30d)', `${growth >= 0 ? '+' : ''}${growth.toFixed(1)}%`],
      ],
      status: snapshot.note ? `sample · ${snapshot.note}` : 'connected',
      provenance: snapshot.provenance,
      age: freshness(),
    },
  };
};

const modules = {
  instagram: await instagram(),
  stocks: await stocks(),
  projects: await projects(),
  sports: await sports(),
  calendar: await calendar(),
  weather: await weather(),
  news: await news(),
  music: await music(),
  system: await system(),
};

await mkdir('src/generated', { recursive: true });
await writeFile(
  'src/generated/sampleModules.json',
  JSON.stringify(modules, null, 2) + '\n',
  'utf8',
);
console.log(`wrote ${Object.keys(modules).length} module payloads`);
