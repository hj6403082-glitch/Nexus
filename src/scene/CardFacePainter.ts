import { ACCENTS, WARNING, type Accent } from '@/core/constants/palette';
import type { ModuleDef } from '@/core/constants/modules';

export const FACE_W = 512;
export const FACE_H = 704;

export interface FaceData {
  title: string;
  caption: string;
  /** Large figure, e.g. "12.4K". */
  metric?: string;
  metricLabel?: string;
  /** Secondary rows: [label, value]. */
  rows?: [string, string][];
  /** 0..1 series for the sparkline. */
  series?: number[];
  status?: string;
  provenance?: string;
  age?: string;
  warned?: boolean;
}

/**
 * Card faces are drawn into a 2D canvas and used as a texture, rather than as
 * DOM overlays.
 *
 * This is the load-bearing decision for Phase 7. The brief requires that the
 * particles which leave a card ARE the pixels of that card, live data included.
 * If the face were DOM, there would be nothing to sample without a rasterising
 * round-trip. Because it is a canvas, the dissolve samples the exact ImageData
 * that is on screen at the instant of the command — no re-render, no
 * approximation, no second source of truth.
 */
export class CardFacePainter {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private accent: Accent;
  private lastSignature = '';

  constructor(private module: ModuleDef) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = FACE_W;
    this.canvas.height = FACE_H;
    const ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('2D context unavailable');
    this.ctx = ctx;
    this.accent = ACCENTS[module.accent];
  }

  /** Returns true when the canvas actually changed (so the texture needs an upload). */
  paint(data: FaceData): boolean {
    const signature = JSON.stringify(data);
    if (signature === this.lastSignature) return false;
    this.lastSignature = signature;

    const g = this.ctx;
    const accentCss = data.warned ? WARNING.css : this.accent.css;

    g.clearRect(0, 0, FACE_W, FACE_H);

    // Pane.
    const bg = g.createLinearGradient(0, 0, FACE_W, FACE_H);
    bg.addColorStop(0, 'rgba(20, 30, 48, 0.92)');
    bg.addColorStop(1, 'rgba(8, 12, 22, 0.96)');
    g.fillStyle = bg;
    roundRect(g, 0, 0, FACE_W, FACE_H, 34);
    g.fill();

    // Accent hairline at the top — the module's identity in peripheral vision.
    g.fillStyle = accentCss;
    g.globalAlpha = 0.9;
    roundRect(g, 26, 22, FACE_W - 52, 3, 2);
    g.fill();
    g.globalAlpha = 1;

    // Title: 24px equivalent at this resolution, readable across a room.
    g.fillStyle = '#eef3fb';
    g.font = '600 46px ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif';
    g.textBaseline = 'top';
    g.fillText(data.title, 34, 56);

    g.fillStyle = 'rgba(160, 178, 204, 0.85)';
    g.font = '400 22px ui-sans-serif, system-ui, sans-serif';
    g.fillText(data.caption, 34, 114);

    let y = 176;

    if (data.metric) {
      // Tabular figures: a number a person across the room could quote.
      g.fillStyle = accentCss;
      g.font = '300 92px ui-monospace, SFMono-Regular, Menlo, monospace';
      g.fillText(data.metric, 34, y);
      y += 104;
      if (data.metricLabel) {
        g.fillStyle = 'rgba(148, 166, 196, 0.8)';
        g.font = '400 20px ui-sans-serif, system-ui, sans-serif';
        g.fillText(data.metricLabel.toUpperCase(), 36, y);
        y += 34;
      }
      y += 14;
    }

    if (data.series && data.series.length > 1) {
      this.sparkline(data.series, 34, y, FACE_W - 68, 132, accentCss);
      y += 160;
    }

    if (data.rows) {
      g.font = '400 24px ui-monospace, SFMono-Regular, Menlo, monospace';
      for (const [label, value] of data.rows.slice(0, 7)) {
        g.fillStyle = 'rgba(150, 168, 198, 0.9)';
        g.fillText(label, 34, y);
        g.fillStyle = '#dce6f6';
        const w = g.measureText(value).width;
        g.fillText(value, FACE_W - 34 - w, y);
        g.strokeStyle = 'rgba(120, 150, 200, 0.12)';
        g.lineWidth = 1;
        g.beginPath();
        g.moveTo(34, y + 34);
        g.lineTo(FACE_W - 34, y + 34);
        g.stroke();
        y += 46;
      }
    }

    // Provenance strip. Every figure says where it came from and how old it is.
    const footY = FACE_H - 56;
    g.font = '400 18px ui-sans-serif, system-ui, sans-serif';
    g.fillStyle = data.warned ? WARNING.css : 'rgba(128, 148, 180, 0.75)';
    g.fillText(data.status ?? 'nominal', 34, footY);
    const meta = [data.provenance, data.age].filter(Boolean).join(' · ');
    if (meta) {
      const w = g.measureText(meta).width;
      g.fillStyle = 'rgba(110, 130, 162, 0.7)';
      g.fillText(meta, FACE_W - 34 - w, footY);
    }

    // Border last so it sits over everything.
    g.strokeStyle = data.warned ? WARNING.css : 'rgba(150, 190, 255, 0.28)';
    g.lineWidth = 2;
    roundRect(g, 1, 1, FACE_W - 2, FACE_H - 2, 34);
    g.stroke();

    return true;
  }

  private sparkline(
    series: number[],
    x: number,
    y: number,
    w: number,
    h: number,
    colour: string,
  ): void {
    const g = this.ctx;
    let min = Infinity;
    let max = -Infinity;
    for (const v of series) {
      if (v < min) min = v;
      if (v > max) max = v;
    }
    const span = max - min || 1;
    const px = (i: number) => x + (i / (series.length - 1)) * w;
    const py = (v: number) => y + h - ((v - min) / span) * h;

    // Fill under the curve.
    const fill = g.createLinearGradient(0, y, 0, y + h);
    fill.addColorStop(0, withAlpha(colour, 0.28));
    fill.addColorStop(1, withAlpha(colour, 0));
    g.beginPath();
    g.moveTo(px(0), y + h);
    series.forEach((v, i) => g.lineTo(px(i), py(v)));
    g.lineTo(px(series.length - 1), y + h);
    g.closePath();
    g.fillStyle = fill;
    g.fill();

    g.beginPath();
    series.forEach((v, i) => (i === 0 ? g.moveTo(px(i), py(v)) : g.lineTo(px(i), py(v))));
    g.strokeStyle = colour;
    g.lineWidth = 2.5;
    g.lineJoin = 'round';
    g.stroke();

    // Head dot.
    g.beginPath();
    g.arc(px(series.length - 1), py(series[series.length - 1]), 5, 0, Math.PI * 2);
    g.fillStyle = colour;
    g.fill();
  }

  /** The pixels, for the Phase 7 dissolve. */
  readPixels(): ImageData {
    return this.ctx.getImageData(0, 0, FACE_W, FACE_H);
  }

  get moduleId(): string {
    return this.module.id;
  }
}

function roundRect(
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

function withAlpha(css: string, a: number): string {
  const m = css.match(/rgb\((\d+)\s+(\d+)\s+(\d+)\)/);
  if (!m) return css;
  return `rgba(${m[1]}, ${m[2]}, ${m[3]}, ${a})`;
}
