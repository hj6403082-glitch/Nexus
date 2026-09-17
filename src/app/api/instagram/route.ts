import { NextResponse } from 'next/server';
import { fetchInstagram } from '@/server/data/instagram';
import { compact, freshness } from '@/server/data/adapters';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const snapshot = await fetchInstagram();
  const series = snapshot.followerSeries;
  const growth =
    series.length > 1 ? ((series[series.length - 1] - series[0]) / Math.max(series[0], 1)) * 100 : 0;

  return NextResponse.json({
    provenance: snapshot.provenance,
    detail: snapshot,
    face: {
      title: 'Instagram',
      caption: 'Reach · Growth · Engagement',
      metric: compact(snapshot.followers),
      metricLabel: 'followers',
      // The reconstructed running total, not the raw daily deltas — see
      // backAccumulate in server/data/instagram.ts.
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
  });
}
