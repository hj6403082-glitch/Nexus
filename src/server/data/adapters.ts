import type { FaceData } from '@/scene/CardFacePainter';

export interface ModulePayload {
  face: FaceData;
  detail: unknown;
  provenance: 'live' | 'sample';
}

const ago = (at: number): string => {
  const s = Math.round((Date.now() - at) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  return `${Math.round(s / 3600)}h ago`;
};

export const freshness = () => ago(Date.now());

export const compact = (n: number): string => {
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toFixed(0);
};

// ---------------------------------------------------------------- stocks ---
const PORTFOLIO = [
  { symbol: 'NVDA', shares: 42, cost: 118.4 },
  { symbol: 'AAPL', shares: 65, cost: 187.2 },
  { symbol: 'MSFT', shares: 30, cost: 402.8 },
  { symbol: 'TSM', shares: 80, cost: 148.9 },
  { symbol: 'ASML', shares: 8, cost: 812.0 },
];

export async function stocks(): Promise<ModulePayload> {
  const key = process.env.FINNHUB_API_KEY;
  let provenance: 'live' | 'sample' = 'sample';
  const quotes: Record<string, number> = {};

  if (key) {
    try {
      const results = await Promise.all(
        PORTFOLIO.map(async (p) => {
          const r = await fetch(
            `https://finnhub.io/api/v1/quote?symbol=${p.symbol}&token=${key}`,
            { cache: 'no-store' },
          );
          if (!r.ok) throw new Error(String(r.status));
          const j = (await r.json()) as { c?: number };
          return [p.symbol, j.c ?? 0] as const;
        }),
      );
      for (const [symbol, price] of results) quotes[symbol] = price;
      if (Object.values(quotes).some((v) => v > 0)) provenance = 'live';
    } catch {
      provenance = 'sample';
    }
  }

  const holdings = PORTFOLIO.map((p) => {
    const price = quotes[p.symbol] || p.cost * (1 + samplePct(p.symbol));
    const value = price * p.shares;
    const pl = (price - p.cost) * p.shares;
    return { ...p, price, value, pl };
  });

  const total = holdings.reduce((s, h) => s + h.value, 0);
  const pl = holdings.reduce((s, h) => s + h.pl, 0);
  const plPct = (pl / (total - pl)) * 100;

  return {
    provenance,
    detail: { holdings, total, pl, plPct },
    face: {
      title: 'Stocks',
      caption: 'Portfolio · Allocation · P/L',
      metric: `$${compact(total)}`,
      metricLabel: 'portfolio value',
      series: holdings.map((h) => h.value),
      rows: holdings
        .slice(0, 5)
        .map((h) => [h.symbol, `${h.pl >= 0 ? '+' : ''}${h.pl.toFixed(0)}`] as [string, string]),
      status: `${plPct >= 0 ? '+' : ''}${plPct.toFixed(2)}% overall`,
      // Warning orange is reserved. A drawdown past 5% is one of the very few
      // things in NEXUS that earns it.
      warned: plPct < -5,
      provenance,
      age: freshness(),
    },
  };
}

function samplePct(symbol: string): number {
  let h = 0;
  for (let i = 0; i < symbol.length; i++) h = (h * 31 + symbol.charCodeAt(i)) % 997;
  return (h / 997) * 0.44 - 0.12;
}

// --------------------------------------------------------------- weather ---
export async function weather(): Promise<ModulePayload> {
  const key = process.env.OPENWEATHER_API_KEY;
  if (key) {
    try {
      const r = await fetch(
        `https://api.openweathermap.org/data/2.5/weather?q=London&units=metric&appid=${key}`,
        { cache: 'no-store' },
      );
      if (r.ok) {
        const j = (await r.json()) as {
          main: { temp: number; feels_like: number; humidity: number };
          weather: { main: string; description: string }[];
          wind: { speed: number };
          name: string;
        };
        const condition = j.weather[0]?.main ?? 'Clear';
        return {
          provenance: 'live',
          detail: { ...j, condition },
          face: {
            title: 'Weather',
            caption: j.name,
            metric: `${j.main.temp.toFixed(0)}°`,
            metricLabel: j.weather[0]?.description ?? condition,
            rows: [
              ['feels like', `${j.main.feels_like.toFixed(0)}°`],
              ['humidity', `${j.main.humidity}%`],
              ['wind', `${j.wind.speed.toFixed(1)} m/s`],
            ],
            status: condition.toLowerCase(),
            provenance: 'live',
            age: freshness(),
          },
        };
      }
    } catch {
      /* fall through to sample */
    }
  }
  return {
    provenance: 'sample',
    detail: { condition: 'Fog', temp: 9 },
    face: {
      title: 'Weather',
      caption: 'Conditions · Forecast',
      metric: '9°',
      metricLabel: 'fog, settling',
      rows: [
        ['feels like', '7°'],
        ['humidity', '94%'],
        ['wind', '1.2 m/s'],
      ],
      status: 'fog',
      provenance: 'sample',
      age: freshness(),
    },
  };
}

// ------------------------------------------------------------------ news ---
export async function news(): Promise<ModulePayload> {
  const key = process.env.NEWS_API_KEY;
  if (key) {
    try {
      const r = await fetch(
        `https://newsapi.org/v2/top-headlines?category=technology&language=en&pageSize=8&apiKey=${key}`,
        { cache: 'no-store' },
      );
      if (r.ok) {
        const j = (await r.json()) as {
          articles: { title: string; source: { name: string }; url: string; publishedAt: string }[];
        };
        return {
          provenance: 'live',
          detail: { articles: j.articles },
          face: {
            title: 'News',
            caption: 'Summarised · Stacked',
            metric: String(j.articles.length),
            metricLabel: 'stories in the stack',
            rows: j.articles
              .slice(0, 5)
              .map((a) => [a.source.name.slice(0, 16), a.title.slice(0, 22)] as [string, string]),
            status: 'technology',
            provenance: 'live',
            age: freshness(),
          },
        };
      }
    } catch {
      /* fall through */
    }
  }
  const articles = [
    { title: 'Spatial interfaces move from demo to product', source: { name: 'The Verge' } },
    { title: 'On-device hand tracking hits sub-20ms', source: { name: 'IEEE' } },
    { title: 'What WebGPU changes for the browser', source: { name: 'Ars' } },
    { title: 'Colour grading, in real time', source: { name: 'FXGuide' } },
    { title: 'The quiet return of skeuomorphic light', source: { name: 'Dezeen' } },
  ];
  return {
    provenance: 'sample',
    detail: { articles },
    face: {
      title: 'News',
      caption: 'Summarised · Stacked',
      metric: String(articles.length),
      metricLabel: 'stories in the stack',
      rows: articles.map((a) => [a.source.name, a.title.slice(0, 20)] as [string, string]),
      status: 'technology',
      provenance: 'sample',
      age: freshness(),
    },
  };
}

// ---------------------------------------------------------------- sports ---
export async function sports(): Promise<ModulePayload> {
  const fixtures = [
    ['Arsenal — Spurs', '2 – 1'],
    ['Liverpool — City', '0 – 0'],
    ['Chelsea — Villa', '3 – 2'],
    ['Newcastle — Brighton', '1 – 1'],
  ] as [string, string][];
  return {
    provenance: 'sample',
    detail: { fixtures },
    face: {
      title: 'Sports',
      caption: 'Live · Fixtures · Standings',
      metric: '4',
      metricLabel: 'matches live',
      rows: fixtures,
      status: 'matchday',
      provenance: 'sample',
      age: freshness(),
    },
  };
}

// -------------------------------------------------------------- calendar ---
export async function calendar(): Promise<ModulePayload> {
  const now = new Date();
  const at = (h: number, m: number) => {
    const d = new Date(now);
    d.setHours(h, m, 0, 0);
    return d;
  };
  const events = [
    { title: 'Design review', start: at(10, 0) },
    { title: 'Shader pass — halation', start: at(13, 30) },
    { title: 'Gesture latency retro', start: at(16, 0) },
  ];
  const next = events.find((e) => e.start > now) ?? events[0];
  return {
    provenance: 'sample',
    detail: { events: events.map((e) => ({ ...e, start: e.start.toISOString() })) },
    face: {
      title: 'Calendar',
      caption: 'Schedule · Today · Ahead',
      metric: next.start.toTimeString().slice(0, 5),
      metricLabel: `next · ${next.title}`,
      rows: events.map(
        (e) => [e.start.toTimeString().slice(0, 5), e.title.slice(0, 20)] as [string, string],
      ),
      status: `${events.length} today`,
      provenance: 'sample',
      age: freshness(),
    },
  };
}

// ----------------------------------------------------------------- music ---
export async function music(): Promise<ModulePayload> {
  return {
    provenance: 'sample',
    detail: { track: 'Substrate', artist: 'Lorn', transport: 'bridge' },
    face: {
      title: 'Music',
      caption: 'Transport · Now Playing',
      metric: 'Substrate',
      metricLabel: 'now playing',
      rows: [
        ['artist', 'Lorn'],
        ['source', 'system transport'],
        ['control', 'voice · ⌘K'],
      ],
      status: 'transport via desktop bridge',
      provenance: 'sample',
      age: freshness(),
    },
  };
}

// -------------------------------------------------------------- projects ---
export async function projects(): Promise<ModulePayload> {
  const items = [
    { name: 'NEXUS', status: 'active', repo: 'krishiyswim23-swagger/Nexus_AI' },
    { name: 'Volumetric study', status: 'paused', repo: '—' },
    { name: 'Gesture latency harness', status: 'active', repo: '—' },
  ];
  return {
    provenance: 'sample',
    detail: { items },
    face: {
      title: 'Projects',
      caption: 'Worlds · Media · History',
      metric: String(items.length),
      metricLabel: 'worlds',
      rows: items.map((p) => [p.name.slice(0, 18), p.status] as [string, string]),
      status: 'two active',
      provenance: 'sample',
      age: freshness(),
    },
  };
}

// ---------------------------------------------------------------- system ---
export async function system(): Promise<ModulePayload> {
  const mem = process.memoryUsage();
  const rows: [string, string][] = [
    ['heap', `${(mem.heapUsed / 1048576).toFixed(0)} MB`],
    ['rss', `${(mem.rss / 1048576).toFixed(0)} MB`],
    ['node', process.version],
    ['platform', process.platform],
    ['uptime', `${(process.uptime() / 60).toFixed(0)}m`],
  ];
  return {
    provenance: 'live',
    detail: { memory: mem, platform: process.platform, uptime: process.uptime() },
    face: {
      title: 'System',
      caption: 'GPU · Memory · Network',
      metric: `${(mem.heapUsed / 1048576).toFixed(0)}`,
      metricLabel: 'MB heap in use',
      rows,
      status: 'nominal',
      provenance: 'live',
      age: freshness(),
    },
  };
}
