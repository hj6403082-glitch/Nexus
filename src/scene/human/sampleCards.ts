import { MODULES } from '@/core/constants/modules';
import { FACE_H, FACE_W } from '@/scene/CardFacePainter';
import { cardRegistry } from '@/scene/cardRegistry';
import { CARD_SIZE } from '@/scene/Card';
import { makeRandom } from '@/core/math/util';

export interface CardSample {
  local: Float32Array; // xyz in the card's local frame
  tint: Float32Array; // rgb
  index: Float32Array; // which card
  kind: Float32Array; // 0 pane · 1 type · 2 accent
  count: number;
}

/**
 * RASTERISE EVERY CARD FACE EXACTLY AS IT IS DRAWN, and sample it.
 *
 * This runs once, at the instant of the command, against the live canvas — the
 * same pixels the user is looking at, live data included. There is no
 * re-render and no second source of truth, which is the only way the promise
 * "the particles that leave the cards ARE the particles that become the human"
 * can actually be kept.
 *
 * Pixels are classified into three streams, because a card is not one material:
 *   - TYPE becomes small hot fragments (bright, low saturation — glyph pixels).
 *   - CHARTS AND GLYPHS become accent-coloured streams (saturated).
 *   - THE PANE becomes dim glass (everything else).
 */
export function sampleCardFaces(total: number): CardSample {
  const handles = MODULES.map((m) => cardRegistry.get(m.id)).filter(
    (h): h is NonNullable<typeof h> => Boolean(h),
  );

  const local = new Float32Array(total * 3);
  const tint = new Float32Array(total * 3);
  const index = new Float32Array(total);
  const kind = new Float32Array(total);

  if (handles.length === 0) return { local, tint, index, kind, count: 0 };

  const perCard = Math.floor(total / handles.length);
  const rand = makeRandom(4242);
  let written = 0;

  handles.forEach((handle, slot) => {
    let pixels: ImageData;
    try {
      pixels = handle.painter.readPixels();
    } catch {
      return; // A tainted canvas would throw; the card simply contributes none.
    }
    const data = pixels.data;
    const quota = slot === handles.length - 1 ? total - written : perCard;

    let placed = 0;
    let attempts = 0;
    const maxAttempts = quota * 24;

    while (placed < quota && attempts < maxAttempts) {
      attempts++;
      const px = Math.floor(rand() * FACE_W);
      const py = Math.floor(rand() * FACE_H);
      const o = (py * FACE_W + px) * 4;
      const a = data[o + 3] / 255;
      if (a < 0.08) continue;

      const r = data[o] / 255;
      const g = data[o + 1] / 255;
      const b = data[o + 2] / 255;
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const sat = max <= 0 ? 0 : (max - min) / max;
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;

      // Importance sampling: keep bright and saturated pixels far more often
      // than the pane, or the figure would be assembled almost entirely out of
      // background glass and none of the type would survive the journey.
      let k: number;
      let keep: number;
      if (lum > 0.62 && sat < 0.3) {
        k = 1; // type
        keep = 1.0;
      } else if (sat > 0.35) {
        k = 2; // chart / glyph accent
        keep = 0.85;
      } else {
        k = 0; // pane glass
        keep = 0.20;
      }
      if (rand() > keep) continue;

      const i = written + placed;
      local[i * 3] = (px / FACE_W - 0.5) * CARD_SIZE.w;
      local[i * 3 + 1] = (0.5 - py / FACE_H) * CARD_SIZE.h;
      local[i * 3 + 2] = 0;
      tint[i * 3] = r;
      tint[i * 3 + 1] = g;
      tint[i * 3 + 2] = b;
      index[i] = handle.index;
      kind[i] = k;
      placed++;
    }

    // If the face was nearly empty, pad from what we did place so no particle
    // is left sitting at the local origin.
    for (let i = placed; i < quota; i++) {
      const src = written + (placed > 0 ? i % placed : 0);
      const dst = written + i;
      local.copyWithin(dst * 3, src * 3, src * 3 + 3);
      tint.copyWithin(dst * 3, src * 3, src * 3 + 3);
      index[dst] = handle.index;
      kind[dst] = kind[src];
    }

    written += quota;
  });

  return { local, tint, index, kind, count: written };
}
