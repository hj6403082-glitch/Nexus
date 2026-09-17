/**
 * INSTAGRAM.
 *
 * Two entirely different APIs hide behind the phrase "Instagram token", and
 * which one you have is written in the FIRST FOUR CHARACTERS of the token:
 *
 *   IGAA…  Instagram Login (Instagram API with Instagram Login).
 *          Host: graph.instagram.com. The account is addressed as `me` — there
 *          is no separate account id to supply, and supplying one 400s.
 *
 *   EAA…   Facebook Login (Instagram API with Facebook Login).
 *          Host: graph.facebook.com. The account MUST be addressed by its
 *          explicit business account id; `me` resolves to the Facebook user,
 *          not the Instagram account, and silently returns the wrong entity.
 *
 * Detecting the prefix is the difference between "it works" and a 400 whose
 * message does not mention either of these facts.
 */
export type TokenFlavour = 'instagram-login' | 'facebook-login' | 'none';

export function detectFlavour(token: string | undefined): TokenFlavour {
  if (!token) return 'none';
  if (token.startsWith('IGAA')) return 'instagram-login';
  if (token.startsWith('EAA')) return 'facebook-login';
  return 'none';
}

export interface InstagramSnapshot {
  followers: number;
  reach: number;
  engagement: number;
  reels: number;
  /** Reconstructed running totals, oldest first. */
  followerSeries: number[];
  top: { caption: string; likes: number; comments: number }[];
  provenance: 'live' | 'sample';
  note?: string;
}

/**
 * THE FOLLOWER CHART.
 *
 * `follower_count` from the insights endpoint returns DAILY DELTAS — how many
 * followers were gained that day — not a running total. Plotting the raw values
 * produces a chart that hovers around a small number and looks like the account
 * is going nowhere, which is both wrong and demoralising.
 *
 * The true curve is reconstructed by BACK-ACCUMULATING from the current total:
 * today's total is known, so yesterday's is today minus today's delta, and so
 * on backwards through the window.
 */
export function backAccumulate(currentTotal: number, dailyDeltas: number[]): number[] {
  const series = new Array<number>(dailyDeltas.length + 1);
  series[series.length - 1] = currentTotal;
  for (let i = dailyDeltas.length - 1; i >= 0; i--) {
    series[i] = series[i + 1] - dailyDeltas[i];
  }
  return series;
}

export async function fetchInstagram(): Promise<InstagramSnapshot> {
  const token = process.env.INSTAGRAM_ACCESS_TOKEN;
  const flavour = detectFlavour(token);
  if (flavour === 'none' || !token) return sample('no token configured');

  const host = flavour === 'instagram-login' ? 'graph.instagram.com' : 'graph.facebook.com';
  const businessId = process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID;

  if (flavour === 'facebook-login' && !businessId) {
    // The EAA path cannot address the account without this, and `me` would
    // quietly return the Facebook user instead of the Instagram account.
    return sample('EAA token needs INSTAGRAM_BUSINESS_ACCOUNT_ID');
  }
  const subject = flavour === 'instagram-login' ? 'me' : businessId!;

  try {
    const profileRes = await fetch(
      `https://${host}/v21.0/${subject}?fields=followers_count,media_count&access_token=${token}`,
      { cache: 'no-store' },
    );
    if (!profileRes.ok) return sample(`profile ${profileRes.status}`);
    const profile = (await profileRes.json()) as { followers_count?: number; media_count?: number };

    const since = Math.floor(Date.now() / 1000) - 60 * 60 * 24 * 29;
    const insightsRes = await fetch(
      `https://${host}/v21.0/${subject}/insights?metric=follower_count,reach&period=day&since=${since}&access_token=${token}`,
      { cache: 'no-store' },
    );
    const insights = insightsRes.ok
      ? ((await insightsRes.json()) as {
          data?: { name: string; values: { value: number }[] }[];
        })
      : { data: [] };

    const followerDeltas =
      insights.data?.find((d) => d.name === 'follower_count')?.values.map((v) => v.value) ?? [];
    const reachValues =
      insights.data?.find((d) => d.name === 'reach')?.values.map((v) => v.value) ?? [];

    const followers = profile.followers_count ?? 0;

    const mediaRes = await fetch(
      `https://${host}/v21.0/${subject}/media?fields=caption,like_count,comments_count,media_product_type&limit=25&access_token=${token}`,
      { cache: 'no-store' },
    );
    const media = mediaRes.ok
      ? ((await mediaRes.json()) as {
          data?: {
            caption?: string;
            like_count?: number;
            comments_count?: number;
            media_product_type?: string;
          }[];
        })
      : { data: [] };

    const items = media.data ?? [];
    const reels = items.filter((m) => m.media_product_type === 'REELS').length;
    const top = [...items]
      .sort((a, b) => (b.like_count ?? 0) - (a.like_count ?? 0))
      .slice(0, 4)
      .map((m) => ({
        caption: (m.caption ?? 'Untitled').split('\n')[0].slice(0, 46),
        likes: m.like_count ?? 0,
        comments: m.comments_count ?? 0,
      }));

    const reach = reachValues.reduce((a, b) => a + b, 0);
    const interactions = items.reduce(
      (sum, m) => sum + (m.like_count ?? 0) + (m.comments_count ?? 0),
      0,
    );

    return {
      followers,
      reach,
      engagement: reach > 0 ? interactions / reach : 0,
      reels,
      followerSeries: backAccumulate(followers, followerDeltas),
      top,
      provenance: 'live',
    };
  } catch (err) {
    return sample(err instanceof Error ? err.message : 'request failed');
  }
}

/** Deterministic sample data, clearly labelled as such everywhere it surfaces. */
function sample(note: string): InstagramSnapshot {
  const followers = 12482;
  const deltas = Array.from({ length: 29 }, (_, i) => Math.round(18 + Math.sin(i / 3.1) * 22 + i * 0.7));
  return {
    followers,
    reach: 184920,
    engagement: 0.071,
    reels: 14,
    followerSeries: backAccumulate(followers, deltas),
    top: [
      { caption: 'Spatial interface study, take four', likes: 2841, comments: 132 },
      { caption: 'Volumetric fog, one light', likes: 2210, comments: 88 },
      { caption: 'Hand tracking latency breakdown', likes: 1904, comments: 211 },
      { caption: 'Shader notes: halation', likes: 1622, comments: 64 },
    ],
    provenance: 'sample',
    note,
  };
}
