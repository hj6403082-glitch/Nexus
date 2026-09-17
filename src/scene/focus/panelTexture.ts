import * as THREE from 'three';

export interface PanelSpec {
  title: string;
  lines: string[];
  accent: string;
  footer?: string;
}

const W = 640;
const H = 384;

/**
 * A small canvas panel used by the in-scene module stages.
 *
 * Canvas rather than drei `<Text>` deliberately: these panels carry wrapped
 * prose of unpredictable length, and an SDF text component needs a font atlas
 * fetched over the network before it can draw a single glyph. A 2D context is
 * already there, wraps for free, and — as with the card faces — produces real
 * pixels that the Phase 7 dissolve could sample if these are ever on screen
 * when the command lands.
 */
export function paintPanel(spec: PanelSpec): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext('2d')!;

  const bg = g.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, 'rgba(18, 27, 42, 0.94)');
  bg.addColorStop(1, 'rgba(8, 12, 20, 0.96)');
  g.fillStyle = bg;
  round(g, 0, 0, W, H, 22);
  g.fill();

  g.fillStyle = spec.accent;
  round(g, 26, 22, 64, 3, 2);
  g.fill();

  g.textBaseline = 'top';
  g.fillStyle = '#eef3fb';
  g.font = '600 34px ui-sans-serif, system-ui, sans-serif';
  let y = wrap(g, spec.title, 26, 48, W - 52, 40);

  g.font = '400 21px ui-sans-serif, system-ui, sans-serif';
  g.fillStyle = 'rgba(176, 192, 216, 0.88)';
  y += 14;
  for (const line of spec.lines) {
    if (y > H - 80) break;
    y = wrap(g, line, 26, y, W - 52, 28) + 8;
  }

  if (spec.footer) {
    g.font = '400 17px ui-monospace, SFMono-Regular, Menlo, monospace';
    g.fillStyle = 'rgba(120, 140, 172, 0.8)';
    g.fillText(spec.footer, 26, H - 44);
  }

  g.strokeStyle = 'rgba(150, 190, 255, 0.22)';
  g.lineWidth = 2;
  round(g, 1, 1, W - 2, H - 2, 22);
  g.stroke();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

export const PANEL_ASPECT = W / H;

function wrap(
  g: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
): number {
  const words = text.split(/\s+/);
  let line = '';
  let cursor = y;
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (g.measureText(candidate).width > maxWidth && line) {
      g.fillText(line, x, cursor);
      cursor += lineHeight;
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) {
    g.fillText(line, x, cursor);
    cursor += lineHeight;
  }
  return cursor;
}

function round(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}
