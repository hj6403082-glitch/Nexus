import { MODULES, type ModuleId, type WorldId } from '@/core/constants/modules';
import { matchWorld } from '@/core/constants/worlds';

export type Command =
  | { kind: 'open'; module: ModuleId }
  | { kind: 'rotate'; direction: -1 | 1 }
  | { kind: 'close' }
  | { kind: 'transform'; to: 'human' | 'spatial' }
  | { kind: 'lock'; on: boolean }
  | { kind: 'launch'; app: string }
  | { kind: 'browse'; query: string }
  | { kind: 'media'; verb: 'play' | 'pause' | 'next' | 'previous' }
  | { kind: 'environment'; world: WorldId }
  | { kind: 'ask'; text: string };

/**
 * LOCAL COMMAND MATCHING.
 *
 * Matched here, before the model, for one reason: latency you can feel. The
 * beat between the words and the room responding has to be a breath, not a
 * network round-trip. Anything this misses falls through to the model, which
 * keeps a `transform_form` tool for exactly that case — so a phrasing the
 * matcher does not know still works, it just works a second later.
 */
export function matchCommand(raw: string): Command {
  const text = raw.toLowerCase().trim().replace(/[.!?,]+$/g, '');

  // --- Phase 7: the two phrasings, matched locally and acted on immediately -
  if (
    /\b(transform|turn|change|shift)\b.*\b(human|person|body|humanoid)\b/.test(text) ||
    /\bhuman (form|shape|mode)\b/.test(text)
  ) {
    return { kind: 'transform', to: 'human' };
  }
  if (
    /\breturn to (spatial|normal|the ring|cards)\b/.test(text) ||
    /\b(back to|exit|leave)\b.*\b(spatial|normal|ring|cards)\b/.test(text) ||
    /\bspatial mode\b/.test(text)
  ) {
    return { kind: 'transform', to: 'spatial' };
  }

  // --- ring ---------------------------------------------------------------
  if (/\brotate (left|anticlockwise|counter-?clockwise)\b/.test(text) || /\bgo left\b/.test(text)) {
    return { kind: 'rotate', direction: -1 };
  }
  if (/\brotate (right|clockwise)\b/.test(text) || /\bgo right\b/.test(text)) {
    return { kind: 'rotate', direction: 1 };
  }
  if (/\b(close|dismiss|go back|back to the ring)\b/.test(text)) return { kind: 'close' };
  if (/\b(lock|freeze|hold still|stop moving)\b/.test(text)) return { kind: 'lock', on: true };
  if (/\b(unlock|drift|start moving|breathe)\b/.test(text)) return { kind: 'lock', on: false };

  // --- media --------------------------------------------------------------
  if (/^(play|resume)\b/.test(text)) return { kind: 'media', verb: 'play' };
  if (/^(pause|stop)\b/.test(text)) return { kind: 'media', verb: 'pause' };
  if (/\b(next|skip) (track|song)\b/.test(text)) return { kind: 'media', verb: 'next' };
  if (/\b(previous|last) (track|song)\b/.test(text)) return { kind: 'media', verb: 'previous' };

  // --- environments --------------------------------------------------------
  // Checked BEFORE modules, because "show me the lab" names a place and
  // "open projects" names a module, and the opener verb is the same word.
  if (/\b(environment|world|room|take me to|switch to|go to the)\b/.test(text)) {
    const world = matchWorld(text);
    if (world) return { kind: 'environment', world };
  }

  // --- modules ------------------------------------------------------------
  const opener = /\b(open|show|bring up|go to|display|launch)\b/.test(text);
  for (const module of MODULES) {
    const names = [module.label.toLowerCase(), ...module.aliases];
    for (const name of names) {
      if (!text.includes(name)) continue;
      // "How is Nvidia today?" mentions no module name; "open stocks" does.
      // Require either an explicit opener verb or the bare module name alone.
      if (opener || text === name) return { kind: 'open', module: module.id };
    }
  }

  // --- desktop bridge -----------------------------------------------------
  const launch = text.match(/^(?:open|launch|start)\s+(.+)$/);
  if (launch && !/\bhttps?:|\.com|\.org|\.io\b/.test(launch[1])) {
    return { kind: 'launch', app: launch[1] };
  }
  const browse = text.match(/^(?:search|google|look up|youtube)\s+(?:for\s+)?(.+)$/);
  if (browse) return { kind: 'browse', query: browse[1] };

  return { kind: 'ask', text: raw };
}

/** The fixed line NEXUS speaks the instant the transform command lands. */
export const TRANSFORM_ACK = 'Understood. Give me a moment.';

/** What the figure says once its eyes settle. */
export const EMBODIED_GREETING = ["I'm here.", 'How can I help?'];
