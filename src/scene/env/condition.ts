export type Condition = 'clear' | 'clouds' | 'rain' | 'snow' | 'fog' | 'storm';

/**
 * Whatever the weather API called it, in the six shapes the scene can draw.
 *
 * Deliberately a plain module rather than living beside the component: it is
 * pure logic with no renderer in sight, which means it can be tested directly
 * — and the set of strings a weather API can return is exactly the kind of
 * thing that needs a test rather than a hope.
 */
export function readCondition(raw: unknown): Condition {
  const text = String(raw ?? '').toLowerCase();
  if (/thunder|storm/.test(text)) return 'storm';
  if (/drizzle|rain|shower/.test(text)) return 'rain';
  if (/snow|sleet|ice/.test(text)) return 'snow';
  if (/mist|fog|haze|smoke/.test(text)) return 'fog';
  if (/cloud|overcast/.test(text)) return 'clouds';
  return 'clear';
}

/**
 * Per-condition behaviour. `fall` is metres per second downward, `drift` is
 * lateral wander, `streak` stretches each particle along its own velocity —
 * which is the whole difference between rain and snow at a glance.
 */
export const PROFILE: Record<
  Condition,
  { fall: number; drift: number; streak: number; size: number; density: number; colour: string }
> = {
  clear: { fall: 0.04, drift: 0.3, streak: 0.0, size: 0.7, density: 0.0, colour: '#ffd9a8' },
  clouds: { fall: 0.12, drift: 0.55, streak: 0.0, size: 2.6, density: 0.45, colour: '#9fb4d0' },
  rain: { fall: 7.5, drift: 0.18, streak: 0.26, size: 0.9, density: 1.0, colour: '#a8c8ff' },
  storm: { fall: 11.0, drift: 0.35, streak: 0.38, size: 1.0, density: 1.0, colour: '#bcd4ff' },
  snow: { fall: 0.55, drift: 0.85, streak: 0.0, size: 1.7, density: 0.8, colour: '#e6f0ff' },
  fog: { fall: 0.05, drift: 0.45, streak: 0.0, size: 3.4, density: 0.9, colour: '#b6c8e8' },
};
